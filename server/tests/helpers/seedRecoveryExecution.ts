import { initializeDb, db } from '../../src/db/index.js'
import { createExecution } from '../../src/services/executionStore.js'
import { getTemporalClient, closeTemporalClient } from '../../src/temporal/client.js'
import { taskQueueFor } from '../../src/temporal/config.js'
import type { Workflow } from '../../src/types/index.js'
import { validateWorkflow, validateVariables } from '../../src/middleware/validation.js'

// 仅用于独立进程故障测试；输入来自测试父进程，拒绝默认数据库。
if (!process.env.DB_PATH || process.env.DB_PATH === ':memory:') throw new Error('恢复测试必须显式指定临时文件数据库')
let text = ''
for await (const chunk of process.stdin) text += chunk.toString()
const input: unknown = JSON.parse(text)
if (!input || typeof input !== 'object' || !('workflowId' in input) || typeof input.workflowId !== 'number' ||
  !('url' in input) || typeof input.url !== 'string' || !('requestKey' in input) || typeof input.requestKey !== 'string' ||
  !('engineVersion' in input) || typeof input.engineVersion !== 'string' || !('acceptInTemporal' in input) || typeof input.acceptInTemporal !== 'boolean') {
  throw new Error('恢复测试种子输入格式错误')
}
await initializeDb()
try {
  const definition = await db.get<{ name: string; description: string | null; variables: string; nodes: string; edges: string }>('SELECT * FROM workflows WHERE id=?', [input.workflowId])
  if (!definition) throw new Error('恢复测试缺少已保存的工作流')
  const workflow: Workflow = { ...validateWorkflow({ name: definition.name, description: definition.description || undefined,
    variables: JSON.parse(definition.variables), nodes: JSON.parse(definition.nodes), edges: JSON.parse(definition.edges) }), id: input.workflowId }
  const variables = validateVariables(workflow.variables, {})
  const row = await createExecution(workflow, variables, input.engineVersion, { maxOutputBytes: 1048576, maxNodeCalls: 1000 }, input.requestKey)
  if (input.acceptInTemporal) {
    if (!row.temporal_workflow_id) throw new Error('种子执行缺少 Temporal ID')
    const client = await getTemporalClient()
    await client.workflow.start('graphWorkflow', {
      workflowId: row.temporal_workflow_id, taskQueue: taskQueueFor(input.engineVersion),
      args: [{ executionId: row.id, engineVersion: input.engineVersion }]
    })
  }
  // 不保存 started，模拟持久化后退出，或 Temporal 已接受但确认尚未保存。
  console.log(JSON.stringify({ executionId: row.id, temporalWorkflowId: row.temporal_workflow_id, startState: row.start_state }))
} finally { await closeTemporalClient(); await db.close() }
