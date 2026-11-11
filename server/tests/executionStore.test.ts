import { beforeAll, describe, expect, it } from 'vitest'
import type { Workflow } from '../src/types/index.js'

process.env.DB_PATH = ':memory:'
const database = await import('../src/db/index.js')
const store = await import('../src/services/executionStore.js')
const limits = { maxOutputBytes: 1048576, maxNodeCalls: 1000 }
const workflow: Workflow = { id: 7, name: '不可变快照', nodes: [
  { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
  { id: 'e', type: 'end', position: { x: 1, y: 0 }, data: {} }
], edges: [{ id: 'se', source: 's', target: 'e' }] }

beforeAll(async () => { await database.initializeDb() })

describe('持久化执行记录', () => {
  it('过期尝试不能抢占新尝试结果或让新尝试永远运行', async () => {
    const row = await store.createExecution(workflow, {}, 'v1', limits)
    const call = { executionId: row.id, invocationId: 'overlap', nodeId: 's', scopePath: 'root', sequence: 1, contextRef: null, locals: {} }
    await store.prepareNodeRun(call, 1, {})
    await store.prepareNodeRun(call, 2, {})
    await expect(store.completeNodeRun(call, 1, { from: 1 }, {})).rejects.toThrow()
    const result = await store.completeNodeRun(call, 2, { from: 2 }, {})
    await store.saveExecutionCompletion(row.id, 'success', result.outputRef!)
    await store.settleExecution(row.id, 'success', result.outputRef!)
    const execution = await store.readExecution(row.id)
    expect(execution?.nodeRuns?.map(run => run.status)).toEqual(['failed', 'success'])
    expect(execution?.context.s).toMatchObject({ status: 'success', output: { from: 2 } })
    expect(await store.readExecutionEvents(row.id, execution!.last_event_id!)).toEqual([])
  })
  it('已有成功缓存会封存当前已准备的尝试并发送该次成功事件', async () => {
    const row = await store.createExecution(workflow, {}, 'v1', limits)
    const call = { executionId: row.id, invocationId: 'cached-overlap', nodeId: 's', scopePath: 'root', sequence: 1, contextRef: null, locals: {} }
    await store.prepareNodeRun(call, 1, {})
    const first = await store.completeNodeRun(call, 1, 42, {})
    await store.prepareNodeRun(call, 2, {})
    const cached = await store.completeNodeRun(call, 2, 99, {})
    expect(cached.outputRef).toBe(first.outputRef)
    const execution = await store.readExecution(row.id)
    expect(execution?.nodeRuns?.map(run => run.status)).toEqual(['success', 'success'])
    expect(execution?.context.s.output).toBe(42)
    const events = await store.readExecutionEvents(row.id, 0)
    expect(events.some(event => event.type === 'nodeRun' && JSON.stringify(event.data).includes('"attempt":2') && JSON.stringify(event.data).includes('"status":"success"'))).toBe(true)
  })
  it('终态后迟到的节点完成、准备和日志不能改变结果或追加尾事件', async () => {
    const row = await store.createExecution(workflow, {}, 'v1', limits)
    const call = { executionId: row.id, invocationId: 'late-result', nodeId: 's', scopePath: 'root', sequence: 1, contextRef: null, locals: {} }
    await store.prepareNodeRun(call, 1, {})
    await store.saveExecutionCompletion(row.id, 'failed', null, 'Activity timeout')
    await store.settleExecution(row.id, 'failed', null, 'Activity timeout')
    const before = await store.readExecution(row.id)
    await expect(store.completeNodeRun(call, 1, 'late', {})).rejects.toThrow()
    await expect(store.cacheControlPreparation(call, ['late'])).rejects.toThrow()
    await expect(store.prepareNodeRun(call, 2, {})).rejects.toThrow()
    await store.failNodeRun(call, 1, 'late overwrite', 'stopped')
    await store.appendEvent(row.id, 'late-log', 'log', 's', { time: 'late', nodeId: 's', level: 'info', message: 'late' })
    expect(await store.readExecution(row.id)).toEqual(before)
    expect(await store.readExecutionEvents(row.id, before!.last_event_id!)).toEqual([])
  })
  it('固定快照、版本及限额，并用请求键去重和稳定的 Temporal ID 启动', async () => {
    const variables = { amount: 42 }
    const row = await store.createExecution(workflow, variables, 'v1', limits, 'request-1')
    variables.amount = 90
    expect(row.temporal_workflow_id).toMatch(new RegExp(`^workflow-execution-${row.id}-[0-9a-f-]{36}$`))
    expect(row.start_state).toBe('pending')
    const duplicate = await store.createExecution(workflow, {}, 'v2', limits, 'request-1')
    expect(duplicate.id).toBe(row.id)
    expect(duplicate.temporal_workflow_id).toBe(row.temporal_workflow_id)
    expect(await store.getExecutionSnapshot(row.id)).toEqual({ id: row.id, workflow, variables: { amount: 42 }, engineVersion: 'v1', limits })
    await store.markExecutionStarted(row.id)
    expect((await store.getExecutionRow(row.id))?.start_state).toBe('started')
  })

  it('值引用校验执行归属，上下文快照不可变', async () => {
    const row = await store.createExecution(workflow, {}, 'v1', limits)
    const other = await store.createExecution(workflow, {}, 'v1', limits)
    const ref = await store.writeValue(row.id, { value: 1 })
    expect(await store.readValue(ref, row.id)).toEqual({ value: 1 })
    await expect(store.readValue(ref, other.id)).rejects.toThrow('归属')
    const first = await store.writeContextReferences(row.id, { s: ref })
    await store.writeContextReferences(row.id, {})
    expect(await store.readContextReferences(row.id, first)).toEqual({ s: ref })
  })

  it('完成意图不抢占 Temporal 终态，校正只生成一个完成事件', async () => {
    const row = await store.createExecution(workflow, {}, 'v1', limits)
    const ref = await store.writeValue(row.id, false)
    await store.saveExecutionCompletion(row.id, 'success', ref)
    expect((await store.getExecutionRow(row.id))?.status).toBe('running')
    expect(await store.readExecutionEvents(row.id, 0)).toEqual([])
    await store.settleExecution(row.id, 'success', ref)
    await store.settleExecution(row.id, 'success', ref)
    const events = await store.readExecutionEvents(row.id, 0)
    expect(events.filter(event => event.type === 'completed')).toHaveLength(1)
    expect(await store.readExecutionEvents(row.id, events.at(-1)!.id)).toEqual([])
    expect((await store.readExecution(row.id))?.result).toBe(false)
  })

  it('保留旧记录，只将无 Temporal ID 的旧运行标记中断', async () => {
    const legacy = await database.db.run("INSERT INTO executions(workflow_id,status,context,logs,result) VALUES(7,'running','{}','[]','null')")
    const current = await store.createExecution(workflow, {}, 'v1', limits)
    await store.interruptLegacyExecutions()
    expect((await store.readExecution(legacy.lastID))?.status).toBe('stopped')
    expect((await store.getExecutionRow(current.id))?.status).toBe('running')
  })

  it('并发的普通写入不会进入另一调用将回滚的事务', async () => {
    let entered: (() => void) | undefined
    let release: (() => void) | undefined
    const ready = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const rollback = database.db.transaction(async () => {
      await database.db.run("INSERT INTO workflows(name,nodes,edges) VALUES('将回滚','[]','[]')")
      entered?.()
      await gate
      throw new Error('测试回滚')
    })
    await ready
    const unrelated = database.db.run("INSERT INTO workflows(name,nodes,edges) VALUES('独立写入','[]','[]')")
    // 让原始 SQLite 连接有机会处理独立写入，再释放事务。
    await new Promise<void>(resolve => setImmediate(resolve))
    release?.()
    await expect(rollback).rejects.toThrow('测试回滚')
    await unrelated
    expect(await database.db.get("SELECT name FROM workflows WHERE name='独立写入'")).toEqual({ name: '独立写入' })
  })

  it('事件按小批游标分页，不重复或丢失', async () => {
    const row = await store.createExecution(workflow, {}, 'v1', limits)
    for (let i = 0; i < 25; i++) await database.db.run('INSERT INTO execution_events(execution_id,event_key,type,node_id,data) VALUES(?,?,?,?,?)',
      [row.id, `test-${i}`, 'state', 's', JSON.stringify({ index: i })])
    const first = await store.readExecutionEvents(row.id, 0)
    expect(first).toHaveLength(20)
    const second = await store.readExecutionEvents(row.id, first.at(-1)!.id)
    expect(second).toHaveLength(5)
    expect(second[0].data).toEqual({ index: 20 })
  })
})
