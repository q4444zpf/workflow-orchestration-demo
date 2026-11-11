import { beforeAll, describe, expect, it } from 'vitest'
import { MockActivityEnvironment } from '@temporalio/testing'
import http from 'node:http'
import type { Workflow } from '../src/types/index.js'
import type { NodeCall } from '../src/temporal/contracts.js'

process.env.DB_PATH = ':memory:'
const database = await import('../src/db/index.js')
const store = await import('../src/services/executionStore.js')
const activities = await import('../src/temporal/activities.js')
const limits = { maxOutputBytes: 1048576, maxNodeCalls: 1000 }
const workflow: Workflow = { id: 1, name: '最小 Activity', nodes: [
  { id: 's', type: 'start', position: { x: 0, y: 0 }, data: { inputMapping: { amount: 'var.amount' } } },
  { id: 'b', type: 'branch', position: { x: 1, y: 0 }, data: { condition: 'ctx.s.output.amount === 42' } },
  { id: 'e', type: 'end', position: { x: 2, y: 0 }, data: { resultExpression: 'ctx.s.output.amount' } }
], edges: [{ id: 'sb', source: 's', target: 'b' }, { id: 'be', source: 'b', target: 'e', label: 'true' }] }
const call = (executionId: number, nodeId: string, sequence: number, contextRef: string | null = null): NodeCall => ({ executionId, nodeId, sequence, contextRef, invocationId: `root/${nodeId}`, scopePath: 'root', locals: {} })

beforeAll(async () => { await database.initializeDb() })

describe('Temporal 最小 Activities', () => {
  it.each([
    { name: '未配置映射时透传运行变量', data: {}, output: { score: 90, region: '西区' } },
    { name: '空映射时透传运行变量', data: { inputMapping: {} }, output: { score: 90, region: '西区' } },
    { name: '配置映射时保留原始输入', data: { inputMapping: { selectedScore: 'var.score' } }, output: { selectedScore: 90 } }
  ])('开始节点$name，查询与推送均记录实际输入', async ({ data, output }) => {
    const row = await store.createExecution({ ...workflow, nodes: [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, data }
    ], edges: [] }, { score: 90, region: '西区' }, 'v2', limits)
    await new MockActivityEnvironment().run(activities.executeNodeActivity, call(row.id, 's', 1))
    const execution = await store.readExecution(row.id)
    expect(execution?.nodeRuns?.[0].input).toEqual({ score: 90, region: '西区' })
    expect(execution?.context.s.input).toEqual({ score: 90, region: '西区' })
    expect(execution?.nodeRuns?.[0].output).toEqual(output)
    const events = await store.readExecutionEvents(row.id, 0)
    expect(events.filter(event => event.type === 'state').map(event => event.data)).toMatchObject([
      { input: { score: 90, region: '西区' }, status: 'running' },
      { input: { score: 90, region: '西区' }, output, status: 'success' }
    ])
  })
  it('只向 Workflow 返回紧凑图及引用，输入输出和逐次记录保存至 SQL', async () => {
    const row = await store.createExecution(workflow, { amount: 42 }, 'v1', limits)
    const plan = await activities.loadExecutionPlan(row.id, 'v1')
    expect(plan.nodes[0]).toEqual({ id: 's', type: 'start', timeoutMs: 30000, maximumAttempts: 1 })
    expect(JSON.stringify(plan)).not.toContain('inputMapping')
    await expect(activities.loadExecutionPlan(row.id, 'v2')).rejects.toThrow('版本')
    const environment = new MockActivityEnvironment()
    const start = await environment.run(activities.executeNodeActivity, call(row.id, 's', 1))
    const branch = await environment.run(activities.executeNodeActivity, call(row.id, 'b', 2, start.contextRef))
    expect(branch.route).toBe('true')
    const end = await environment.run(activities.executeNodeActivity, call(row.id, 'e', 3, branch.contextRef))
    expect(await store.readValue(end.outputRef!, row.id)).toBe(42)
    const execution = await store.readExecution(row.id)
    expect(execution?.nodeRuns).toHaveLength(3)
    expect(execution?.context.s.output).toEqual({ amount: 42 })
    expect(execution?.context.b.input).toEqual({ s: { amount: 42 } })
    const events = await store.readExecutionEvents(row.id, 0)
    expect(events.find(event => event.type === 'state')?.data).toMatchObject({ status: 'running', output: null })
    expect(events.some(event => event.type === 'log')).toBe(true)
  })

  it('已落库输出的重试复用结果，各attempt有成功事件且重复回写去重', async () => {
    const row = await store.createExecution(workflow, { amount: 42 }, 'v1', limits)
    const input = call(row.id, 's', 1)
    const first = await new MockActivityEnvironment({ attempt: 1 }).run(activities.executeNodeActivity, input)
    const retry = await new MockActivityEnvironment({ attempt: 2 }).run(activities.executeNodeActivity, input)
    await new MockActivityEnvironment({ attempt: 2 }).run(activities.executeNodeActivity, input)
    expect(retry).toEqual(first)
    const execution = await store.readExecution(row.id)
    expect(execution?.nodeRuns?.map(run => run.attempt)).toEqual([1, 2])
    const states = (await store.readExecutionEvents(row.id, 0)).filter(event => event.type === 'state')
    expect(states.map(event => event.data)).toMatchObject([
      { status: 'running' }, { status: 'success' }, { status: 'success' }
    ])
    const completedRuns = (await store.readExecutionEvents(row.id, 0)).filter(event => event.type === 'nodeRun' &&
      event.data && typeof event.data === 'object' && 'status' in event.data && event.data.status === 'success')
    expect(completedRuns.map(event => event.data)).toMatchObject([{ attempt: 1 }, { attempt: 2 }])
  })

  it('按 UTF-8 字节拒绝超大输出，保存失败记录并不截断结果', async () => {
    const row = await store.createExecution(workflow, { amount: '莲花江' }, 'v1', { ...limits, maxOutputBytes: 8 })
    await expect(new MockActivityEnvironment().run(activities.executeNodeActivity, call(row.id, 's', 1))).rejects.toThrow('输出')
    const execution = await store.readExecution(row.id)
    expect(execution?.nodeRuns?.[0].status).toBe('failed')
    expect(execution?.context.s.error).toContain('8')
  })

  it('HTTP 已成功落库但回复丢失时，下一 attempt 不再调用外部服务', async () => {
    let requests = 0
    const server = http.createServer((_request, response) => {
      requests++
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ requests }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('本地测试端口不可用')
    try {
      const row = await store.createExecution({ ...workflow, nodes: [
        { id: 'http', type: 'http', position: { x: 0, y: 0 }, data: { method: 'POST', url: `http://127.0.0.1:${address.port}` } }
      ], edges: [] }, {}, 'v1', limits)
      const input = call(row.id, 'http', 1)
      const first = await new MockActivityEnvironment({ attempt: 1 }).run(activities.executeNodeActivity, input)
      const retry = await new MockActivityEnvironment({ attempt: 2 }).run(activities.executeNodeActivity, input)
      expect(retry).toEqual(first)
      expect(requests).toBe(1)
      expect(await store.readValue(first.outputRef!, row.id)).toMatchObject({ data: { requests: 1 } })
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  })

  it('输出值和逻辑结果缓存同一事务提交，缓存写入失败时全部回滚', async () => {
    const row = await store.createExecution(workflow, { amount: 42 }, 'v1', limits)
    const input = call(row.id, 's', 1)
    await store.prepareNodeRun(input, 1, {})
    await database.db.exec("CREATE TEMP TRIGGER reject_node_result BEFORE INSERT ON node_results BEGIN SELECT RAISE(ABORT,'缓存写入失败'); END;")
    try {
      await expect(store.completeNodeRun(input, 1, { amount: 42 }, {})).rejects.toThrow('缓存写入失败')
    } finally { await database.db.exec('DROP TRIGGER reject_node_result') }
    expect(await store.getNodeResult(row.id, input.invocationId)).toBeUndefined()
    expect(await database.db.get('SELECT COUNT(*) AS count FROM execution_values WHERE execution_id=?', [row.id])).toEqual({ count: 1 })
    expect((await store.readExecution(row.id))?.nodeRuns?.[0].status).toBe('running')
  })

  it('局部变量和覆盖引用只影响本次调用，不改变基础上下文', async () => {
    const row = await store.createExecution({ ...workflow, nodes: [
      { id: 'e', type: 'end', position: { x: 0, y: 0 }, data: { resultExpression: 'var.item' } }
    ], edges: [] }, { item: '全局' }, 'v1', limits)
    const firstItem = await store.writeValue(row.id, '第一轮')
    const secondItem = await store.writeValue(row.id, '第二轮')
    const first = await new MockActivityEnvironment().run(activities.executeNodeActivity, { ...call(row.id, 'e', 1), invocationId: 'root/loop/0/e', locals: { item: firstItem } })
    const second = await new MockActivityEnvironment().run(activities.executeNodeActivity, { ...call(row.id, 'e', 2), invocationId: 'root/loop/1/e', locals: { item: secondItem } })
    expect(await store.readValue(first.outputRef!, row.id)).toBe('第一轮')
    expect(await store.readValue(second.outputRef!, row.id)).toBe('第二轮')
    expect((await store.getExecutionSnapshot(row.id)).variables.item).toBe('全局')
  })
})
