import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import supertest from 'supertest'
import http from 'http'
import { getTemporalClient, closeTemporalClient } from '../src/temporal/client.js'
import { Worker, bundleWorkflowCode } from '@temporalio/worker'
import { TestWorkflowEnvironment } from '@temporalio/testing'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import * as activities from '../src/temporal/activities.js'
import { taskQueueFor } from '../src/temporal/config.js'

process.env.DB_PATH = ':memory:'
process.env.WORKFLOW_ENGINE_VERSION = `test-routes-${randomUUID()}`

const database = await import('../src/db/index.js')
const { initializeDb } = database
const { createApp } = await import('../src/app.js')

let app: ReturnType<typeof createApp>
let environment: TestWorkflowEnvironment
let worker: Worker
let workerRun: Promise<void>

beforeAll(async () => {
  await initializeDb()
  environment = await TestWorkflowEnvironment.createFromExistingServer()
  const workflowBundle = await bundleWorkflowCode({ workflowsPath: fileURLToPath(new URL('../src/temporal/workflows.ts', import.meta.url)) })
  worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: taskQueueFor(process.env.WORKFLOW_ENGINE_VERSION!), workflowBundle, activities })
  workerRun = worker.run()
  app = createApp()
}, 60000)
afterAll(async () => {
  worker?.shutdown()
  await workerRun
  await closeTemporalClient()
  await environment?.teardown()
})

async function waitForExecution(id: number): Promise<Record<string, any>> {
  for (let i = 0; i < 200; i++) {
    const res = await supertest(app).get(`/api/executions/${id}`).expect(200)
    if (res.body.status !== 'running') {
      return res.body
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Execution ${id} did not finish in time`)
}

describe('REST routes', () => {
  it('可视化嵌套参数与Python子字段、结束组合结果真实执行，必填问题在启动前返回字段路径', async () => {
    const created = await supertest(app).post('/api/workflows').send({ name: '可视化参数闭环', variables: [
      { name: 'score', type: 'number', required: true }, { name: 'enabled', type: 'boolean', default: false },
      { name: 'user', type: 'object', default: { name: '张三' }, properties: [{ name: 'name', type: 'string', required: true }] },
      { name: 'orders', type: 'array', items: { type: 'object', properties: [{ name: 'qty', type: 'number', required: true }] } }
    ], nodes: [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'py', type: 'python', position: { x: 1, y: 0 }, data: { inputMapping: { score: 'var.score', orders: 'var.orders', previous: 'ctx.s.output.enabled' }, code: "OUTPUT = {'score': score + sum(item['qty'] for item in orders), 'enabled': previous}", outputVar: 'OUTPUT', outputMapping: { score: 'OUTPUT.score', enabled: 'OUTPUT.enabled' } } },
      { id: 'e', type: 'end', position: { x: 2, y: 0 }, data: { resultMapping: { score: 'ctx.py.output.score', enabled: 'ctx.py.output.enabled', user: 'var.user.name' } } }
    ], edges: [{ id: 'sp', source: 's', target: 'py' }, { id: 'pe', source: 'py', target: 'e' }] }).expect(201)
    const invalid = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({ variables: { orders: [{ qty: '2' }] } }).expect(400)
    expect(invalid.body.issues.map((issue: { path: string }) => issue.path)).toEqual(['score', 'orders.0.qty'])
    const started = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({ variables: { score: 90, orders: [{ qty: 2 }] } }).expect(200)
    const execution = await waitForExecution(started.body.executionId)
    expect(execution.status).toBe('success')
    expect(execution.result).toEqual({ score: 92, enabled: false, user: '张三' })
    expect(execution.nodeRuns[1].input.s).toEqual({ score: 90, enabled: false, user: { name: '张三' }, orders: [{ qty: 2 }] })
  }, 30000)
  it('HTTP可视化请求体/查询/请求头保持值类型并投影响应', async () => {
    const received: { body?: unknown; query?: string | null; header?: string | string[] } = {}
    const endpoint = http.createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk.toString()
      received.body = JSON.parse(body); received.query = new URL(req.url || '/', 'http://local').searchParams.get('score'); received.header = req.headers['x-score']
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ score: 0, accepted: false }))
    })
    await new Promise<void>(resolve => endpoint.listen(0, '127.0.0.1', resolve))
    const address = endpoint.address(); if (!address || typeof address === 'string') throw new Error('测试端口不可用')
    try {
      const created = await supertest(app).post('/api/workflows').send({ name: '可视化HTTP闭环', variables: [{ name: 'score', type: 'number', default: 90 }], nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
        { id: 'h', type: 'http', position: { x: 1, y: 0 }, data: { url: `http://127.0.0.1:${address.port}`, method: 'POST', requestBody: { kind: 'object', fields: { score: { kind: 'reference', path: 'var.score' }, enabled: { kind: 'literal', value: false } } }, requestQuery: { score: { kind: 'reference', path: 'var.score' } }, requestHeaders: { 'X-Score': { kind: 'reference', path: 'var.score' } }, outputMapping: { score: 'RESULT.data.score', accepted: 'RESULT.data.accepted' } } },
        { id: 'e', type: 'end', position: { x: 2, y: 0 }, data: { resultExpression: 'ctx.h.output' } }
      ], edges: [{ id: 'sh', source: 's', target: 'h' }, { id: 'he', source: 'h', target: 'e' }] }).expect(201)
      const run = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({}).expect(200)
      expect((await waitForExecution(run.body.executionId)).result).toEqual({ score: 0, accepted: false })
      expect(received).toEqual({ body: { score: 90, enabled: false }, query: '90', header: '90' })
    } finally { await new Promise<void>(resolve => endpoint.close(() => resolve())) }
  }, 30000)
  it.each([undefined, {}])('开始节点记录提交值和默认值，下游可引用缺省或空映射的透传输出：%j', async inputMapping => {
    const created = await supertest(app).post('/api/workflows').send({ name: '运行输入可观察', variables: [
      { name: 'score', type: 'number', default: 70 }, { name: 'region', type: 'string', default: '西区' }
    ], nodes: [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, data: { inputMapping } },
      { id: 'e', type: 'end', position: { x: 1, y: 0 }, data: { resultExpression: 'ctx.s.output.score' } }
    ], edges: [{ id: 'se', source: 's', target: 'e' }] }).expect(201)
    const run = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({ variables: { score: 90 } }).expect(200)
    const execution = await waitForExecution(run.body.executionId)
    expect(execution.status).toBe('success')
    expect(execution.nodeRuns[0].input).toEqual({ score: 90, region: '西区' })
    expect(execution.context.s.input).toEqual({ score: 90, region: '西区' })
    expect(execution.context.s.output).toEqual({ score: 90, region: '西区' })
    expect(execution.result).toBe(90)
  })
  it('工作流JSON版本可往返保存，旧JSON默认为1且未知版本被拒绝', async () => {
    const draft = { name: 'JSON版本', schema_version: 1, nodes: [], edges: [] }
    const created = await supertest(app).post('/api/workflows').send(draft).expect(201)
    const detail = await supertest(app).get(`/api/workflows/${created.body.id}`).expect(200)
    expect(detail.body.schema_version).toBe(1)
    await supertest(app).put(`/api/workflows/${created.body.id}`).send({ ...draft, name: '版本草稿已修改' }).expect(200)
    expect((await supertest(app).get(`/api/workflows/${created.body.id}`)).body.schema_version).toBe(1)
    const legacy = await supertest(app).post('/api/workflows').send({ name: '旧JSON', nodes: [], edges: [] }).expect(201)
    expect((await supertest(app).get(`/api/workflows/${legacy.body.id}`)).body.schema_version).toBe(1)
    await supertest(app).post('/api/workflows').send({ ...draft, schema_version: 2 }).expect(400)
    await supertest(app).post('/api/workflows').send({ ...draft, schema_version: '1' }).expect(400)
  })
  it('同请求标识仅复用相同定义与变量，冲突时返回409', async () => {
    const key = `intent-${randomUUID()}`
    const workflow = { name: '启动请求去重边界', nodes: [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'e', type: 'end', position: { x: 1, y: 0 }, data: { resultExpression: 'var.amount' } }
    ], edges: [{ id: 'se', source: 's', target: 'e' }] }
    const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
    const url = `/api/workflows/${created.body.id}/execute`
    const first = await supertest(app).post(url).set('Idempotency-Key', key).send({ variables: { amount: 1, payload: { a: 1, b: 2 } } }).expect(200)
    const duplicate = await supertest(app).post(url).set('Idempotency-Key', key).send({ variables: { payload: { b: 2, a: 1 }, amount: 1 } }).expect(200)
    expect(duplicate.body.executionId).toBe(first.body.executionId)
    await supertest(app).post(url).set('Idempotency-Key', key).send({ variables: { amount: 2, payload: { a: 1, b: 2 } } }).expect(409)
    workflow.nodes[1].data.resultExpression = 'var.other'
    await supertest(app).put(`/api/workflows/${created.body.id}`).send(workflow).expect(200)
    await supertest(app).post(url).set('Idempotency-Key', key).send({ variables: { amount: 1, payload: { a: 1, b: 2 } } }).expect(409)
    const finished = await waitForExecution(first.body.executionId)
    expect(finished.result).toBe(1)
  })
  it('输出按UTF8字节限制，限额在启动时固定且调用上限不能绕过', async () => {
    const oldOutput = process.env.WORKFLOW_MAX_OUTPUT_BYTES
    const oldCalls = process.env.WORKFLOW_MAX_NODE_CALLS
    // 小型显式映射让开始节点先成功，独立验证结束节点的 UTF-8 输出临界值。
    const minimal = { name: '容量边界', variables: [{ name: 'marker', type: 'number', default: 0 }], nodes: [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, data: { inputMapping: { marker: 'var.marker' } } },
      { id: 'e', type: 'end', position: { x: 1, y: 0 }, data: { resultExpression: 'var.text' } }
    ], edges: [{ id: 'se', source: 's', target: 'e' }] }
    try {
      process.env.WORKFLOW_MAX_OUTPUT_BYTES = '32'
      process.env.WORKFLOW_MAX_NODE_CALLS = '2'
      const created = await supertest(app).post('/api/workflows').send(minimal).expect(201)
      const exact = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({ variables: { text: '中'.repeat(10) } }).expect(200)
      const succeeded = await waitForExecution(exact.body.executionId)
      expect(succeeded.status).toBe('success')
      expect(succeeded.result).toBe('中'.repeat(10))
      const exceeded = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({ variables: { text: '中'.repeat(11) } }).expect(200)
      process.env.WORKFLOW_MAX_OUTPUT_BYTES = '4096'
      const failed = await waitForExecution(exceeded.body.executionId)
      expect(failed.status).toBe('failed')
      expect(failed.result.error).toContain('32')
      const row = await database.db.get<{ limits_snapshot: string }>('SELECT limits_snapshot FROM executions WHERE id=?', [exceeded.body.executionId])
      expect(JSON.parse(row!.limits_snapshot)).toEqual({ maxOutputBytes: 32, maxNodeCalls: 2 })
      process.env.WORKFLOW_MAX_NODE_CALLS = '1'
      const limited = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({ variables: { text: 'ok' } }).expect(200)
      const stopped = await waitForExecution(limited.body.executionId)
      expect(stopped.status).toBe('failed')
      expect(stopped.result.error).toContain('上限 1')
      expect(stopped.nodeRuns).toHaveLength(1)
    } finally {
      if (oldOutput === undefined) delete process.env.WORKFLOW_MAX_OUTPUT_BYTES
      else process.env.WORKFLOW_MAX_OUTPUT_BYTES = oldOutput
      if (oldCalls === undefined) delete process.env.WORKFLOW_MAX_NODE_CALLS
      else process.env.WORKFLOW_MAX_NODE_CALLS = oldCalls
    }
  }, 30000)
  it('多条件分支按顺序首个命中，默认出口不掩盖条件错误', async () => {
    const branches = [
      { id: 'high', label: '高分', condition: 'var.score >= 80' },
      { id: 'medium', label: '中等', condition: 'var.score >= 60' },
      { id: 'other', label: '默认', isDefault: true }
    ]
    const workflow = { name: '多分支真实闭环', nodes: [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', type: 'branch', position: { x: 1, y: 0 }, data: { branches } },
      ...branches.map((branch, index) => ({ id: branch.id, type: 'end', position: { x: 2, y: index }, data: { resultExpression: 'ctx.b.output.label' } }))
    ], edges: [{ id: 'sb', source: 's', target: 'b' }, ...branches.map(branch => ({ id: branch.id, source: 'b', target: branch.id, branchId: branch.id, label: '已重命名的连线显示文字' }))] }
    const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
    for (const [score, expected] of [[90, 'high'], [70, 'medium'], [20, 'other']]) {
      const run = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({ variables: { score } }).expect(200)
      const execution = await waitForExecution(run.body.executionId)
      expect(execution.status).toBe('success')
      expect(execution.context.b.output.branchId).toBe(expected)
      expect(execution.nodeRuns).toHaveLength(3)
    }
    branches[0].condition = '42'
    await supertest(app).put(`/api/workflows/${created.body.id}`).send(workflow).expect(200)
    const run = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({ variables: { score: 90 } }).expect(200)
    const failed = await waitForExecution(run.body.executionId)
    expect(failed.status).toBe('failed')
    expect(failed.result.error).toContain('boolean')
    expect(failed.context.other).toBeUndefined()
  }, 30000)
  it('Python 节点经 Temporal 执行并保留打印日志和输出映射', async () => {
    const created = await supertest(app).post('/api/workflows').send({ name: 'Python真实闭环', nodes: [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'py', type: 'python', position: { x: 1, y: 0 }, data: { code: 'print("Python日志验证")\nOUTPUT = amount * 2', inputMapping: { amount: 'var.amount' }, outputMapping: { result: 'OUTPUT' }, outputVar: 'OUTPUT' } },
      { id: 'e', type: 'end', position: { x: 2, y: 0 }, data: { resultExpression: 'ctx.py.output.result' } }
    ], edges: [{ id: 'sp', source: 's', target: 'py' }, { id: 'pe', source: 'py', target: 'e' }] }).expect(201)
    const run = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({ variables: { amount: 21 } }).expect(200)
    const execution = await waitForExecution(run.body.executionId)
    expect(execution.status).toBe('success')
    expect(execution.result).toBe(42)
    expect(execution.logs.some((log: { message: string }) => log.message.includes('Python日志验证'))).toBe(true)
  }, 30000)
  it('SSE 续传与查询快照游标一致，终态重连不重复日志', async () => {
    const created = await supertest(app).post('/api/workflows').send({ name: 'SSE游标', nodes: [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} }, { id: 'e', type: 'end', position: { x: 1, y: 0 }, data: {} }
    ], edges: [{ id: 'se', source: 's', target: 'e' }] }).expect(201)
    const run = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({}).expect(200)
    const execution = await waitForExecution(run.body.executionId)
    const events = await supertest(app).get(`/api/executions/${run.body.executionId}/events`).expect(200)
    const ids = [...events.text.matchAll(/^id: (\d+)$/gm)].map(match => Number(match[1]))
    expect(ids.length).toBeGreaterThan(2)
    expect(execution.last_event_id).toBe(ids.at(-1))
    const resumed = await supertest(app).get(`/api/executions/${run.body.executionId}/events`).set('Last-Event-ID', String(ids.at(-2))).expect(200)
    expect(resumed.text).toContain('"type":"completed"')
    expect(resumed.text).not.toContain('"type":"log"')
    await supertest(app).get(`/api/executions/${run.body.executionId}/events?after=-1`).expect(400)
  })
  it('幂等写操作有限重试并保持幂等键，普通写入及404不盲目重试', async () => {
    const counts = { safe: 0, safeWrites: 0, unsafe: 0, missing: 0 }
    const keys: string[] = []
    const written = new Set<string>()
    const service = http.createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/safe') {
        counts.safe++
        const key = request.headers['idempotency-key']
        if (typeof key === 'string') {
          keys.push(key)
          if (!written.has(key)) { written.add(key); counts.safeWrites++ }
        }
        response.statusCode = counts.safe === 1 ? 503 : 200
      } else if (request.url === '/unsafe') { counts.unsafe++; response.statusCode = 503 }
      else { counts.missing++; response.statusCode = 404 }
      response.end('{"result":42}')
    })
    await new Promise<void>(resolve => service.listen(0, '127.0.0.1', resolve))
    const address = service.address()
    if (!address || typeof address === 'string') throw new Error('测试HTTP服务未就绪')
    try {
      for (const [route, method, idempotent] of [['safe', 'POST', true], ['unsafe', 'POST', false], ['missing', 'GET', false]]) {
        const created = await supertest(app).post('/api/workflows').send({ name: `重试-${route}`, nodes: [
          { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'h', type: 'http', position: { x: 1, y: 0 }, data: { method, idempotent, retry: { maxAttempts: 3 }, url: `http://127.0.0.1:${address.port}/${route}` } },
          { id: 'e', type: 'end', position: { x: 2, y: 0 }, data: { resultExpression: 'ctx.h.output.data.result' } }
        ], edges: [{ id: 'sh', source: 's', target: 'h' }, { id: 'he', source: 'h', target: 'e' }] }).expect(201)
        const run = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({}).expect(200)
        const execution = await waitForExecution(run.body.executionId)
        expect(execution.status).toBe(route === 'safe' ? 'success' : 'failed')
        if (route === 'safe') expect(execution.result).toBe(42)
      }
      expect(counts).toEqual({ safe: 2, safeWrites: 1, unsafe: 1, missing: 1 })
      expect(keys).toHaveLength(2)
      expect(keys[0]).toBe(keys[1])
      expect(keys[0]).toMatch(/^wf-/)
    } finally { await new Promise<void>((resolve, reject) => service.close(error => error ? reject(error) : resolve())) }
  }, 30000)
  it('新执行由真实 Temporal 调度并返回版本与关联标识', async () => {
    const workflow = { name: 'Temporal闭环', nodes: [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'e', type: 'end', position: { x: 1, y: 0 }, data: { resultExpression: 'var.value' } }
    ], edges: [{ id: 'se', source: 's', target: 'e' }] }
    const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
    const run = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({ variables: { value: 42 } }).expect(200)
    const client = await getTemporalClient()
    const initial = await supertest(app).get(`/api/executions/${run.body.executionId}`).expect(200)
    const description = await client.workflow.getHandle(initial.body.temporal_workflow_id).describe()
    expect(description.type).toBe('graphWorkflow')
    const execution = await waitForExecution(run.body.executionId)
    expect(execution).toMatchObject({ status: 'success', result: 42, engine_version: process.env.WORKFLOW_ENGINE_VERSION, temporal_workflow_id: initial.body.temporal_workflow_id })
  })
  describe('工作流结构校验', () => {
    const node = (id: string, type: string) => ({ id, type, position: { x: 0, y: 0 }, data: {} })
    it('空白草稿可以保存，但运行和发布返回具体校验问题', async () => {
      const created = await supertest(app).post('/api/workflows').send({ name: '空白草稿', nodes: [], edges: [] }).expect(201)
      const run = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({}).expect(400)
      expect(run.body.issues).toContainEqual(expect.objectContaining({ code: 'START_COUNT' }))
      expect(run.body).not.toHaveProperty('executionId')
      await supertest(app).post(`/api/workflows/${created.body.id}/publish`).send({ publish_path: 'invalid-draft' }).expect(400)
      const executions = await database.db.prepare('SELECT id FROM executions WHERE workflow_id=?').all(created.body.id)
      expect(executions).toEqual([])
    })
    it('绕过前端也不能执行或发布包含两个开始节点的草稿', async () => {
      const created = await supertest(app).post('/api/workflows').send({ name: '双开始', nodes: [node('s1', 'start'), node('s2', 'start'), node('end', 'end')], edges: [] }).expect(201)
      for (const action of ['execute', 'publish']) {
        const response = await supertest(app).post(`/api/workflows/${created.body.id}/${action}`).send({ publish_path: 'two-starts' }).expect(400)
        expect(response.body.issues).toContainEqual(expect.objectContaining({ code: 'START_COUNT' }))
      }
    })
    it('已发布流程变成非法草稿后公开调用也被拦截', async () => {
      const valid = { name: '发布后编辑', nodes: [node('s', 'start'), node('end', 'end')], edges: [{ id: 'se', source: 's', target: 'end' }] }
      const created = await supertest(app).post('/api/workflows').send(valid).expect(201)
      await supertest(app).post(`/api/workflows/${created.body.id}/publish`).send({ publish_path: 'edited-invalid' }).expect(200)
      await supertest(app).put(`/api/workflows/${created.body.id}`).send({ ...valid, nodes: [node('end', 'end')], edges: [] }).expect(200)
      const response = await supertest(app).post('/api/run/edited-invalid').send({}).expect(400)
      expect(response.body.issues).toContainEqual(expect.objectContaining({ code: 'START_COUNT' }))
    })
  })
  describe('GET /api/apis', () => {
    it('returns an empty list initially', async () => {
      const res = await supertest(app).get('/api/apis').expect(200)
      expect(res.body).toEqual([])
    })
  })

  describe('POST /api/apis', () => {
    it('creates an API and returns its id', async () => {
      const res = await supertest(app)
        .post('/api/apis')
        .send({ name: '加法服务', method: 'POST', url: 'https://httpbin.org/post' })
        .expect(201)

      expect(res.body).toHaveProperty('id')
      expect(typeof res.body.id).toBe('number')

      const list = await supertest(app).get('/api/apis').expect(200)
      expect(list.body).toHaveLength(1)
      expect(list.body[0].name).toBe('加法服务')
    })

    it('returns 400 when required fields are missing', async () => {
      const res = await supertest(app)
        .post('/api/apis')
        .send({ name: 'test' })
        .expect(400)

      expect(res.body).toMatchObject({ status: 400, message: expect.stringContaining('method') })
    })
  })

  describe('GET /api/workflows/:id', () => {
    it('returns 404 for a non-existent id', async () => {
      const res = await supertest(app).get('/api/workflows/999').expect(404)
      expect(res.body).toMatchObject({ status: 404, message: expect.stringContaining('not found') })
    })

    it('returns 400 for an invalid id', async () => {
      const res = await supertest(app).get('/api/workflows/abc').expect(400)
      expect(res.body).toMatchObject({ status: 400, message: expect.stringContaining('Invalid id') })
    })
  })

  describe('POST /api/workflows', () => {
    it('creates a workflow and returns its id', async () => {
      const workflow = {
        name: 'test workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const res = await supertest(app)
        .post('/api/workflows')
        .send(workflow)
        .expect(201)

      expect(res.body).toHaveProperty('id')
      expect(typeof res.body.id).toBe('number')

      const detail = await supertest(app).get(`/api/workflows/${res.body.id}`).expect(200)
      expect(detail.body.name).toBe('test workflow')
      expect(detail.body.nodes).toHaveLength(2)
    })

    it('returns 400 when required fields are missing', async () => {
      const res = await supertest(app)
        .post('/api/workflows')
        .send({ name: 'test' })
        .expect(400)

      expect(res.body).toMatchObject({ status: 400, message: expect.stringContaining('nodes') })
    })
  })

  describe('PUT /api/apis/:id', () => {
    it('returns 404 when updating a non-existent record', async () => {
      const res = await supertest(app)
        .put('/api/apis/999')
        .send({ name: 'missing', method: 'GET', url: 'https://example.com' })
        .expect(404)

      expect(res.body).toMatchObject({ status: 404 })
    })
  })

  describe('DELETE /api/apis/:id', () => {
    it('returns 404 when deleting a non-existent record', async () => {
      const res = await supertest(app).delete('/api/apis/999').expect(404)
      expect(res.body).toMatchObject({ status: 404 })
    })
  })

  describe('POST /api/workflows/:id/execute', () => {
    it('returns executionId immediately and finishes asynchronously', async () => {
      const workflow = {
        name: 'executable workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { inputMapping: { value: 'var.x' } } },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      const res = await supertest(app)
        .post(`/api/workflows/${created.body.id}/execute`)
        .send({ variables: { x: 42 } })
        .expect(200)

      expect(res.body).toHaveProperty('executionId')
      expect(typeof res.body.executionId).toBe('number')
      expect(res.body).not.toHaveProperty('status')

      const execution = await waitForExecution(res.body.executionId)
      expect(execution.status).toBe('success')
      expect(execution.context.start.output.value).toBe(42)
    })
  })

  describe('POST /api/workflows/:id/publish', () => {
    it('publishes a workflow with a URL-safe path', async () => {
      const workflow = {
        name: 'publishable workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      const res = await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: 'my-workflow_1' })
        .expect(200)

      expect(res.body.is_published).toBe(true)
      expect(res.body.publish_path).toBe('my-workflow_1')
    })

    it('rejects an empty or non-URL-safe publish path', async () => {
      const workflow = {
        name: 'unpublishable workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      const empty = await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: '  ' })
        .expect(400)
      expect(empty.body.message).toContain('publish_path')

      const unsafe = await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: 'a/b' })
        .expect(400)
      expect(unsafe.body.message).toContain('URL-safe')
    })

    it('returns 409 when another workflow already uses the publish path', async () => {
      const base = {
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const first = await supertest(app).post('/api/workflows').send({ name: 'first', ...base }).expect(201)
      await supertest(app)
        .post(`/api/workflows/${first.body.id}/publish`)
        .send({ publish_path: 'shared-path' })
        .expect(200)

      const second = await supertest(app).post('/api/workflows').send({ name: 'second', ...base }).expect(201)
      const res = await supertest(app)
        .post(`/api/workflows/${second.body.id}/publish`)
        .send({ publish_path: 'shared-path' })
        .expect(409)

      expect(res.body.message).toContain('already in use')
    })

    it('allows republishing the same workflow with the same path', async () => {
      const workflow = {
        name: 'republishable workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: 'same-path' })
        .expect(200)

      const res = await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: 'same-path' })
        .expect(200)

      expect(res.body.is_published).toBe(true)
      expect(res.body.publish_path).toBe('same-path')
    })
  })

  describe('POST /api/workflows/:id/unpublish', () => {
    it('unpublishes a workflow and clears the publish path', async () => {
      const workflow = {
        name: 'to unpublish',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: 'temp-path' })
        .expect(200)

      const res = await supertest(app)
        .post(`/api/workflows/${created.body.id}/unpublish`)
        .expect(200)

      expect(res.body.is_published).toBe(false)
      expect(res.body.publish_path).toBeNull()
    })
  })

  describe('POST /api/run/:publish_path', () => {
    it('应用变量默认值并拒绝错误类型', async () => {
      const created = await supertest(app).post('/api/workflows').send({
        name: '变量校验', variables: [{ name: 'threshold', type: 'number', default: 0.5 }],
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 1, y: 0 }, data: { resultExpression: 'var.threshold' } }
        ], edges: [{ id: 'e', source: 'start', target: 'end' }]
      }).expect(201)
      await supertest(app).post(`/api/workflows/${created.body.id}/publish`).send({ publish_path: 'typed-variables' }).expect(200)
      const run = await supertest(app).post('/api/run/typed-variables').send({}).expect(200)
      expect((await waitForExecution(run.body.executionId)).result).toBe(0.5)
      await supertest(app).post('/api/run/typed-variables').send({ threshold: 'bad' }).expect(400)
      await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({ variables: { threshold: null } }).expect(400)
    })
    it('executes a published workflow with the provided variables', async () => {
      const workflow = {
        name: 'public workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { inputMapping: { value: 'var.x' } } },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: 'public-run' })
        .expect(200)

      const res = await supertest(app)
        .post('/api/run/public-run')
        .send({ x: 42 })
        .expect(200)

      expect(res.body).toHaveProperty('executionId')
      expect(typeof res.body.executionId).toBe('number')
      expect(res.body).not.toHaveProperty('status')

      const execution = await waitForExecution(res.body.executionId)
      expect(execution.status).toBe('success')
      expect(execution.context.start.output.value).toBe(42)
    })

    it('returns 404 for an unpublished workflow', async () => {
      const workflow = {
        name: 'private workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: 'then-unpublish' })
        .expect(200)
      await supertest(app)
        .post(`/api/workflows/${created.body.id}/unpublish`)
        .expect(200)

      const res = await supertest(app)
        .post('/api/run/then-unpublish')
        .send({})
        .expect(404)
      expect(res.body.message).toContain('not found')
    })
  })

  describe('GET /api/executions/:id/events', () => {
    it('失败流程在完成后订阅仍能收到失败状态和完成通知', async () => {
      const created = await supertest(app).post('/api/workflows').send({
        name: '非法分支条件', nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'branch', type: 'branch', position: { x: 1, y: 0 }, data: { condition: '"false"' } },
          { id: 'yes', type: 'end', position: { x: 2, y: 0 }, data: {} },
          { id: 'no', type: 'end', position: { x: 2, y: 1 }, data: {} }
        ], edges: [{ id: 'e', source: 'start', target: 'branch' }, { id: 'yes', source: 'branch', target: 'yes', label: 'true' }, { id: 'no', source: 'branch', target: 'no', label: 'false' }]
      }).expect(201)
      const run = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({ variables: {} }).expect(200)
      expect((await waitForExecution(run.body.executionId)).status).toBe('failed')
      const events = await supertest(app).get(`/api/executions/${run.body.executionId}/events`).expect(200)
      expect(events.text).toContain('"status":"failed"')
      expect(events.text).toContain('"type":"completed"')
      await supertest(app).get('/api/executions/999999/events').expect(404)
    })
    it('streams execution events via SSE', async () => {
      const workflow = {
        name: 'sse workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { inputMapping: { value: 'var.x' } } },
          { id: 'end', type: 'end', position: { x: 200, y: 0 }, data: { resultExpression: 'var.x' } }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'end' }
        ]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      const executed = await supertest(app)
        .post(`/api/workflows/${created.body.id}/execute`)
        .send({ variables: { x: 42 } })
        .expect(200)

      const executionId = executed.body.executionId
      await waitForExecution(executionId)
      const server = app.listen(0)
      const { port } = server.address() as { port: number }

      const events: string[] = []
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/executions/${executionId}/events`, (res) => {
          res.on('data', (chunk: Buffer) => {
            events.push(chunk.toString())
            const text = events.join('')
            if (text.includes('"type":"completed"')) {
              req.destroy()
              server.close()
              resolve()
            }
          })
          res.on('end', () => {
            server.close()
            resolve()
          })
          res.on('error', (err) => {
            server.close()
            reject(err)
          })
        })
        req.on('error', () => {
          server.close()
          resolve()
        })
        setTimeout(() => {
          req.destroy()
          server.close()
          resolve()
        }, 3000)
      })

      const text = events.join('')
      expect(text).toContain('"type":"connected"')
      expect(text).toContain('"type":"state"')
      expect(text).toContain('"type":"log"')
      expect(text).toContain('"type":"completed"')

      const execution = await waitForExecution(executionId)
      expect(execution.status).toBe('success')
      expect(execution.result).toBe(42)
    }, 30000)
  })
})
