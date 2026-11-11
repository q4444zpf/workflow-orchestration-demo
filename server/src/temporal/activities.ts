import { Context, ApplicationFailure } from '@temporalio/activity'
import { CancelledFailure } from '@temporalio/common'
import { createHash } from 'node:crypto'
import type { ExecutionContext } from '../types/index.js'
import type { CompleteControlCall, ExecutionPlan, NodeCall, NodeTaskResult } from './contracts.js'
import { executeTaskNode } from '../services/nodeExecutor.js'
import { HttpProxyError } from '../services/httpProxy.js'
import { getBranchDefinitions } from '../shared/branches.js'
import { evaluateCondition, requiredString } from '../services/expressions.js'
import { evaluatePath } from '../services/valuePath.js'
import { appendEvent, cacheControlPreparation, completeNodeRun, controlPreparationAttempt, failControlRun, failNodeRun, getExecutionSnapshot, getNodeResult, prepareNodeRun, readContextReferences, readNodeInputForOutput, readValue, recordCachedNodeAttempt, saveExecutionCompletion, StoredExecutionDataError } from '../services/executionStore.js'

export async function loadExecutionPlan(executionId: number, engineVersion: string): Promise<ExecutionPlan> {
  const snapshot = await getExecutionSnapshot(executionId).catch(error => {
    if (error instanceof StoredExecutionDataError) throw ApplicationFailure.nonRetryable(error.message, 'InvalidExecutionSnapshot')
    throw error
  })
  if (snapshot.engineVersion !== engineVersion) throw ApplicationFailure.nonRetryable('执行器版本与启动快照不一致', 'EngineVersionMismatch')
  return { nodes: snapshot.workflow.nodes.map(node => {
    const safe = node.type === 'python' || node.type === 'http' && ((node.data.method || 'GET') === 'GET' || node.data.idempotent === true)
    const attempts = node.data.retry?.maxAttempts ?? (safe ? 3 : 1)
    const timeout = node.data.timeout ?? 30000
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw ApplicationFailure.nonRetryable('节点尝试次数必须为 1 到 3', 'InvalidRetryPolicy')
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 300000) throw ApplicationFailure.nonRetryable('节点超时必须为 1 到 300000 毫秒', 'InvalidTimeout')
    return { id: node.id, type: node.type, timeoutMs: timeout, maximumAttempts: safe ? attempts : 1 }
  }),
  edges: snapshot.workflow.edges, limits: snapshot.limits }
}

export async function executeNodeActivity(call: NodeCall): Promise<NodeTaskResult> {
  const activity = Context.current()
  const attempt = activity.info.attempt
  const cached = await getNodeResult(call.executionId, call.invocationId)
  if (cached) {
    if (cached.outputRef) await recordCachedNodeAttempt(call, attempt)
    return cached
  }
  const snapshot = await getExecutionSnapshot(call.executionId)
  const node = snapshot.workflow.nodes.find(candidate => candidate.id === call.nodeId)
  if (!node) throw ApplicationFailure.nonRetryable('执行快照中找不到节点', 'MissingNode')
  const refs = { ...await readContextReferences(call.executionId, call.contextRef), ...call.contextOverrides }
  const ctx: ExecutionContext = {}
  for (const [nodeId, ref] of Object.entries(refs)) ctx[nodeId] = { input: await readNodeInputForOutput(call.executionId, ref), output: await readValue(ref, call.executionId), status: 'success' }
  const variables = { ...snapshot.variables }
  for (const [key, ref] of Object.entries(call.locals)) variables[key] = await readValue(ref, call.executionId)
  const input = node.type === 'start' ? variables : Object.fromEntries(snapshot.workflow.edges.filter(edge => edge.target === node.id && ctx[edge.source]?.status === 'success')
    .map(edge => [edge.source, ctx[edge.source].output]))
  await prepareNodeRun(call, attempt, input)
  const heartbeat = () => activity.heartbeat({ invocationId: call.invocationId, attempt })
  heartbeat()
  const timer = setInterval(heartbeat, 1000)
  try {
    activity.cancellationSignal.throwIfAborted()
    let output: unknown
    let route: string | undefined
    const key = `${activity.info.workflowExecution?.workflowId || 'execution'}:${call.executionId}:${call.invocationId}`
    if (node.type === 'loop') {
      const items = evaluatePath(requiredString(node.data.iteratorExpression, '循环迭代表达式'), { var: variables, ctx })
      if (!Array.isArray(items)) throw ApplicationFailure.nonRetryable('循环迭代表达式必须返回数组', 'InvalidLoopIterator')
      if (items.length > snapshot.limits.maxNodeCalls - call.sequence) throw ApplicationFailure.nonRetryable(`循环次数超过节点调用上限 ${snapshot.limits.maxNodeCalls}`, 'NodeCallLimit')
      assertOutputSize(items, snapshot.limits.maxOutputBytes)
      return await cacheControlPreparation(call, items, attempt)
    } else if (node.type === 'parallel') {
      return await cacheControlPreparation(call, undefined, attempt)
    } else if (node.type === 'branch' && node.data.branches !== undefined) {
      const branches = getBranchDefinitions(node.data)
      const selected = branches.find(branch => !branch.isDefault && evaluateCondition(requiredString(branch.condition, 'Branch condition'), { var: variables, ctx }))
        || branches.find(branch => branch.isDefault)
      if (!selected) throw ApplicationFailure.nonRetryable('分支缺少默认出口', 'MissingDefaultBranch')
      output = { branchId: selected.id, label: selected.label }
      route = selected.id
    } else {
      output = await executeTaskNode(node, input, { var: variables, ctx }, {
        signal: activity.cancellationSignal, timeoutMs: node.data.timeout || 30000,
        maxOutputBytes: snapshot.limits.maxOutputBytes, invocationKey: key,
        idempotencyKey: `wf-${createHash('sha256').update(key).digest('hex')}`,
        onLog: async (text, level) => appendEvent(call.executionId, `${call.invocationId}:${attempt}:python-log`, 'log', call.nodeId,
          { time: new Date().toISOString(), nodeId: call.nodeId, level, message: `[${call.scopePath}/${call.invocationId} 第${attempt}次] ${text}` })
      })
      if (node.type === 'branch') route = output ? 'true' : 'false'
    }
    assertOutputSize(output, snapshot.limits.maxOutputBytes)
    activity.cancellationSignal.throwIfAborted()
    return await completeNodeRun(call, attempt, output, refs, route ? { route } : {})
  } catch (error) {
    const cancelled = activity.cancellationSignal.aborted
    await failNodeRun(call, attempt, cancelled ? '节点执行已取消' : error instanceof Error ? error.message : String(error), cancelled ? 'stopped' : 'failed')
    if (cancelled) throw new CancelledFailure('节点执行已取消')
    if (error instanceof ApplicationFailure) throw error
    if (error instanceof StoredExecutionDataError) throw ApplicationFailure.nonRetryable(error.message, 'StaleNodeAttempt')
    const invalidResponse = error instanceof HttpProxyError && error.status !== undefined && error.status < 500 && error.status !== 429
    if (node.type === 'branch' || invalidResponse || error instanceof SyntaxError || error instanceof TypeError) {
      throw ApplicationFailure.nonRetryable(error instanceof Error ? error.message : String(error), 'NodeExecutionError')
    }
    throw error
  } finally { clearInterval(timer) }
}

function assertOutputSize(output: unknown, limit: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(output) ?? 'null', 'utf8')
  if (bytes > limit) throw ApplicationFailure.nonRetryable(`节点输出为 ${bytes} 字节，超过 ${limit} 字节限额`, 'OutputLimitExceeded')
}

export async function completeControlActivity({ call, resultRefs }: CompleteControlCall): Promise<NodeTaskResult> {
  const cached = await getNodeResult(call.executionId, call.invocationId)
  if (cached?.outputRef) return cached
  const attempt = await controlPreparationAttempt(call)
  try {
    Context.current().cancellationSignal.throwIfAborted()
    const snapshot = await getExecutionSnapshot(call.executionId)
    const refs = { ...await readContextReferences(call.executionId, call.contextRef), ...call.contextOverrides }
    // 逐个读取并计算 JSON 开销，避免先把所有子结果载入内存才发现总量超限。
    const entries = Array.isArray(resultRefs) ? resultRefs.map((ref, index) => [String(index), ref]) : Object.entries(resultRefs)
    const values: [string, unknown][] = []
    let bytes = 2
    for (const [key, ref] of entries) {
      Context.current().cancellationSignal.throwIfAborted()
      const value = await readValue(ref, call.executionId)
      bytes += Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8') + (values.length ? 1 : 0)
      if (!Array.isArray(resultRefs)) bytes += Buffer.byteLength(JSON.stringify(key), 'utf8') + 1
      if (bytes > snapshot.limits.maxOutputBytes) throw ApplicationFailure.nonRetryable(`控制节点汇总为 ${bytes} 字节，超过 ${snapshot.limits.maxOutputBytes} 字节限额`, 'OutputLimitExceeded')
      values.push([key, value])
    }
    const output = Array.isArray(resultRefs) ? values.map(([, value]) => value) : Object.fromEntries(values)
    return await completeNodeRun(call, attempt, output, refs)
  } catch (error) {
    const cancelled = Context.current().cancellationSignal.aborted
    if (cancelled || error instanceof ApplicationFailure && error.nonRetryable) {
      await failNodeRun(call, attempt, cancelled ? '控制节点汇总已取消' : error instanceof Error ? error.message : String(error), cancelled ? 'stopped' : 'failed')
    }
    if (cancelled) throw new CancelledFailure('控制节点汇总已取消')
    if (error instanceof StoredExecutionDataError) throw ApplicationFailure.nonRetryable(error.message, 'StaleControlAttempt')
    throw error
  }
}
export async function finishExecution(executionId: number, status: 'success' | 'failed' | 'stopped', resultRef: string | null, error?: string): Promise<void> {
  await saveExecutionCompletion(executionId, status, resultRef, error)
}

export async function failControlActivity(call: NodeCall, status: 'failed' | 'stopped', error: string): Promise<void> {
  await failControlRun(call, status, error)
}
