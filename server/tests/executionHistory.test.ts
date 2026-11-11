import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import supertest from 'supertest'
import { db, initializeDb } from '../src/db/index.js'
import { createApp } from '../src/app.js'
import { writeValue } from '../src/services/executionStore.js'

vi.mock('../src/services/executionService.js', () => ({ synchronizeExecution: vi.fn(), startWorkflowExecution: vi.fn() }))
const app = createApp()
const snapshot = { id: 1, name: '评分原名称', nodes: [{ id: 'py', type: 'python', position: { x: 0, y: 0 }, data: { label: '评分计算' } }], edges: [] }
beforeAll(initializeDb)
beforeEach(async () => {
  await db.exec('DELETE FROM execution_events; DELETE FROM node_runs; DELETE FROM execution_values; DELETE FROM executions; DELETE FROM workflows;')
  await db.run('INSERT INTO workflows(id,name,nodes,edges) VALUES(1,?,?,?)', ['后来改名', '[]', '[]'])
  for (const [id, workflowId, status] of [[101, 1, 'success'], [102, 1, 'failed'], [103, 2, 'running']] as const) {
    await db.run('INSERT INTO executions(id,workflow_id,status,started_at,ended_at,variables_snapshot,workflow_snapshot,result,context,logs) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [id, workflowId, status, '2026-11-10T12:00:00Z', status === 'running' ? null : '2026-11-10T12:00:02Z', '{"score":0,"enabled":false}', JSON.stringify(snapshot), status === 'success' ? '0' : 'null', '{}', '[]'])
  }
})
describe('执行历史', () => {
  it('倒序分页，按工作流和状态筛选，概要不携带输入输出快照', async () => {
    const first = await supertest(app).get('/api/executions?page=1&pageSize=2').expect(200)
    expect(first.body.total).toBe(3)
    expect(first.body.items.map((item: { id: number }) => item.id)).toEqual([103, 102])
    expect(first.body.items[1].workflow_name).toBe('评分原名称')
    expect(first.body.items[1]).not.toHaveProperty('variables_snapshot')
    expect(first.body.items[1]).not.toHaveProperty('result')
    const filtered = await supertest(app).get('/api/executions?workflowId=1&status=success&pageSize=1').expect(200)
    expect(filtered.body.total).toBe(1)
    expect(filtered.body.items[0].id).toBe(101)
    expect((await supertest(app).get('/api/executions?page=2&pageSize=2')).body.items[0].id).toBe(101)
    expect((await supertest(app).get('/api/executions?workflowId=999')).body.total).toBe(0)
  })
  it.each(['page=0', 'page=abc', 'pageSize=101', 'status=unknown', 'workflowId=-1', 'page=1&page=2', 'page=9007199254740991'])('拒绝无效查询：%s', async query => {
    await supertest(app).get(`/api/executions?${query}`).expect(400)
  })
  it('详情包含运行输入、启动时节点标签、零值输出及每次失败的时间和异常', async () => {
    const inputRef = await writeValue(102, { score: 0 })
    await db.run('UPDATE executions SET completion_error=? WHERE id=102', ['Python 计算失败'])
    for (const attempt of [1, 2]) await db.run('INSERT INTO node_runs(execution_id,invocation_id,node_id,scope_path,sequence,attempt,status,input_ref,started_at,ended_at,error) VALUES(102,?,?,?,?,?,?,?,?,?,?)',
      ['py-call', 'py', 'root', 1, attempt, 'failed', inputRef, '2026-11-10T12:00:00Z', '2026-11-10T12:00:01Z', `ValueError: 第${attempt}次`])
    const detail = (await supertest(app).get('/api/executions/102').expect(200)).body
    expect(detail.input).toEqual({ score: 0, enabled: false })
    expect(detail.workflow_snapshot.nodes[0].data.label).toBe('评分计算')
    expect(detail.error).toBe('Python 计算失败')
    expect(detail.nodeRuns).toHaveLength(2)
    expect(detail.nodeRuns[1]).toMatchObject({ attempt: 2, error: 'ValueError: 第2次', input: { score: 0 }, endedAt: '2026-11-10T12:00:01Z' })
    expect((await supertest(app).get('/api/executions/101')).body.result).toBe(0)
  })
  it('旧记录缺少快照时明确缺失并保留旧节点数据', async () => {
    await db.run('UPDATE executions SET variables_snapshot=NULL,workflow_snapshot=NULL,context=? WHERE id=101', [JSON.stringify({ old: { status: 'success', input: false, output: 0 } })])
    const detail = (await supertest(app).get('/api/executions/101').expect(200)).body
    expect(detail).not.toHaveProperty('input')
    expect(detail.workflow_snapshot).toBeNull()
    expect(detail.context.old.output).toBe(0)
  })
})
