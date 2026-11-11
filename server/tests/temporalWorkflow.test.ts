import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Worker, bundleWorkflowCode } from '@temporalio/worker'
import type { WorkflowBundle } from '@temporalio/worker'
import { TestWorkflowEnvironment } from '@temporalio/testing'
import type { GraphActivities, NodeCall } from '../src/temporal/contracts.js'

describe('真实 Temporal 图调度', () => {
  let environment: TestWorkflowEnvironment
  let bundle: WorkflowBundle
  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createFromExistingServer({ address: process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233' })
    bundle = await bundleWorkflowCode({ workflowsPath: fileURLToPath(new URL('../src/temporal/workflows.ts', import.meta.url)) })
  }, 60000)
  afterAll(async () => { await environment?.teardown() })

  it('按节点执行并以结果引用完成，不把整次图作为一个 Activity', async () => {
    const calls: string[] = []
    let finished: unknown[] = []
    const activities: GraphActivities = {
      loadExecutionPlan: async () => ({ nodes: [{ id: 's', type: 'start', timeoutMs: 30000, maximumAttempts: 1 }, { id: 'e', type: 'end', timeoutMs: 30000, maximumAttempts: 1 }], edges: [{ id: 'se', source: 's', target: 'e' }], limits: { maxNodeCalls: 1000, maxOutputBytes: 1048576 } }),
      executeNodeActivity: async (call: NodeCall) => {
        calls.push(call.nodeId)
        return { outputRef: `${call.nodeId}-result`, contextRef: `${call.nodeId}-context` }
      },
      completeControlActivity: async () => { throw new Error('直线流程不应调用控制节点汇总') },
      failControlActivity: async () => {},
      finishExecution: async (...args) => { finished = args }
    }
    const queue = `test-${randomUUID()}`
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: queue, workflowBundle: bundle, activities })
    const result = await worker.runUntil(environment.client.workflow.execute('graphWorkflow', { taskQueue: queue, workflowId: randomUUID(), args: [{ executionId: 7, engineVersion: 'v1' }] }))
    expect(result).toBe('e-result')
    expect(calls).toEqual(['s', 'e'])
    expect(finished).toEqual([7, 'success', 'e-result'])
  }, 30000)
})
