import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client'
import { WorkflowIdReusePolicy } from '@temporalio/common'
import { getTemporalClient } from '../temporal/client.js'
import { getEngineVersion, getExecutionLimits, taskQueueFor } from '../temporal/config.js'
import { HttpError } from '../middleware/errorHandler.js'
import { validateVariables } from '../middleware/validation.js'
import { assertValidWorkflowGraph } from './workflowValidator.js'
import { createExecution, getExecutionRow, getExecutionSnapshot, listActiveExecutions, markExecutionStarted, settleExecution } from './executionStore.js'
import type { ExecutionRow } from './executionStore.js'
import type { Workflow } from '../types/index.js'

async function ensureStarted(row: ExecutionRow): Promise<void> {
  if (row.start_state === 'started') return
  if (!row.temporal_workflow_id || !row.engine_version) throw new Error('执行缺少 Temporal 关联或版本')
  const client = await getTemporalClient()
  try {
    await client.workflow.start('graphWorkflow', {
      workflowId: row.temporal_workflow_id, taskQueue: taskQueueFor(row.engine_version),
      args: [{ executionId: row.id, engineVersion: row.engine_version }],
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE
    })
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error
  }
  await markExecutionStarted(row.id)
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).filter(key => Reflect.get(value, key) !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(Reflect.get(value, key))}`).join(',')}}`
}

export async function startWorkflowExecution(workflow: Workflow, inputs: unknown, requestKey?: string): Promise<number> {
  assertValidWorkflowGraph(workflow)
  const variables = validateVariables(workflow.variables, inputs)
  const row = await createExecution(workflow, variables, getEngineVersion(), getExecutionLimits(), requestKey)
  if (row.workflow_id !== workflow.id) throw new HttpError(409, '该请求标识已用于其他工作流')
  if (requestKey) {
    const original = await getExecutionSnapshot(row.id)
    if (canonicalJson(original.workflow) !== canonicalJson(workflow) || canonicalJson(original.variables) !== canonicalJson(variables)) {
      throw new HttpError(409, '同一请求标识不能用于不同的工作流定义或变量，请为新执行使用新的请求标识')
    }
  }
  try { await ensureStarted(row) }
  catch { throw new HttpError(503, `Temporal 启动结果暂未确认，请通过执行 ID ${row.id} 继续查询，避免重复发起。`, undefined, row.id) }
  return row.id
}

function errorMessage(error: unknown): string {
  let current = error
  let result = 'Temporal 工作流执行失败'
  for (let depth = 0; depth < 10 && current instanceof Error; depth++) { result = current.message; current = current.cause }
  return result
}

const syncing = new Map<number, Promise<void>>()
export async function synchronizeExecution(id: number): Promise<void> {
  const ongoing = syncing.get(id)
  if (ongoing) return ongoing
  const task = (async () => {
    const row = await getExecutionRow(id)
    if (!row || !row.temporal_workflow_id || row.status !== 'running') return
    await ensureStarted(row)
    const client = await getTemporalClient()
    const handle = client.workflow.getHandle(row.temporal_workflow_id)
    const description = await handle.describe()
    if (description.status.name === 'RUNNING' || description.status.name === 'PAUSED') return
    if (description.status.name === 'COMPLETED') {
      const reference: unknown = await handle.result()
      if (reference !== null && typeof reference !== 'string') throw new Error('Temporal 返回了无效的结果引用')
      await settleExecution(id, 'success', reference)
    } else {
      const status = ['CANCELLED', 'TERMINATED'].includes(description.status.name) ? 'stopped' : 'failed'
      let message = row.completion_error || `Temporal 执行状态：${description.status.name}`
      try { await handle.result() } catch (error) { message = row.completion_error || errorMessage(error) }
      await settleExecution(id, status, row.result_ref, message)
    }
  })()
  syncing.set(id, task)
  try { await task } finally { syncing.delete(id) }
}

export function startExecutionReconciler(): () => void {
  let active = false
  let stopped = false
  const tick = async () => {
    if (active || stopped) return
    active = true
    try {
      const rows = await listActiveExecutions()
      // 每次限定并发，避免恢复大量执行时占满连接。
      for (let start = 0; start < rows.length && !stopped; start += 4) {
        await Promise.allSettled(rows.slice(start, start + 4).map(row => synchronizeExecution(row.id)))
      }
    } finally { active = false }
  }
  const timer = setInterval(() => { void tick().catch(error => console.warn('执行状态同步失败', errorMessage(error))) }, 1000)
  timer.unref()
  return () => { stopped = true; clearInterval(timer) }
}
