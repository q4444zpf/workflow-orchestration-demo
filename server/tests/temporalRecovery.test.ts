import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import type { ServerResponse } from 'node:http'
import net from 'node:net'
import sqlite3 from 'sqlite3'
import { Client, Connection } from '@temporalio/client'
import type { FlowNode, Workflow } from '../src/types/index.js'

interface RunningProcess { child: ChildProcessWithoutNullStreams; output: () => string; exited: Promise<number | null> }
interface Event { id: number; type: string; nodeId: string; data?: unknown }
const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const children = new Set<RunningProcess>()
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms))
const node = (id: string, type: string, data: FlowNode['data'] = {}): FlowNode => ({ id, type, data, position: { x: 0, y: 0 } })

async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 18000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await pause(80)
  }
  throw new Error(`恢复验证超时：${label}`)
}
function launch(script: string, env: NodeJS.ProcessEnv, input?: unknown): RunningProcess {
  const child = spawn(process.execPath, ['--import', 'tsx', script], { cwd: serverDirectory, env, windowsHide: true, stdio: 'pipe' })
  let output = ''
  const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-80000) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  if (input !== undefined) child.stdin.end(JSON.stringify(input))
  else child.stdin.end()
  const exited = new Promise<number | null>((done, reject) => { child.once('error', reject); child.once('exit', done) })
  const running = { child, output: () => output, exited }
  children.add(running)
  return running
}
async function kill(child: RunningProcess | undefined): Promise<void> {
  if (!child || child.child.exitCode !== null || child.child.signalCode !== null) return
  child.child.kill('SIGKILL')
  await Promise.race([child.exited, pause(5000).then(() => { throw new Error(`子进程未退出：${child.output()}`) })])
}
async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试端口不可用')
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))
  return address.port
}
function decodeEvents(text: string): Event[] {
  const events: Event[] = []
  const blocks = text.split(/\r?\n\r?\n/)
  blocks.pop() // 流式读取时保留最后一个尚未收到空行的片段。
  for (const block of blocks) {
    const id = Number(/^id: (\d+)$/m.exec(block)?.[1])
    const data = /^data: (.+)$/m.exec(block)?.[1]
    if (!Number.isSafeInteger(id) || id < 1 || !data) continue
    const value: unknown = JSON.parse(data)
    if (!record(value) || typeof value.type !== 'string' || typeof value.nodeId !== 'string') throw new Error('事件格式错误')
    events.push({ id, type: value.type, nodeId: value.nodeId, data: value.data })
  }
  return events
}

describe('独立 API/Worker 进程恢复', () => {
  let directory: string
  let dbPath: string
  let env: NodeJS.ProcessEnv
  let base: string
  let probeBase: string
  let api: RunningProcess | undefined
  let worker: RunningProcess | undefined
  let probe: http.Server
  let connection: Connection
  let client: Client
  const version = `test-recovery-${randomUUID()}`
  const knownIds = new Set<string>()
  const traces: { path: string; value: string | null }[] = []
  const hanging = new Set<ServerResponse>()
  let releaseWorkerRequest = false
  let releaseApiRequest = false
  const apiResponses: ServerResponse[] = []

  async function json(path: string, method = 'GET', body?: unknown, expected = 200): Promise<Record<string, unknown>> {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(4000) })
    const result: unknown = await response.json()
    if (response.status !== expected || !record(result)) throw new Error(`API ${method} ${path} 返回 ${response.status}：${JSON.stringify(result)}`)
    return result
  }
  async function startApi(): Promise<void> {
    api = launch('src/index.ts', env)
    await until(async () => {
      if (api?.child.exitCode !== null) throw new Error(`API 提前退出：${api?.output()}`)
      try { return (await fetch(`${base}/api/workflows`, { signal: AbortSignal.timeout(500) })).ok } catch { return false }
    }, 'API 启动')
  }
  async function startWorker(script = 'src/temporal/worker.ts'): Promise<void> {
    worker = launch(script, env)
    await until(() => {
      if (worker?.child.exitCode !== null) throw new Error(`Worker 提前退出：${worker?.output()}`)
      return worker.output().includes("state: 'RUNNING'")
    }, 'Worker 启动')
  }
  async function sql<T>(query: string, params: unknown[] = []): Promise<T | undefined> {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE)
    db.configure('busyTimeout', 5000)
    try { return await new Promise<T | undefined>((done, reject) => db.get<T>(query, params, (error, row) => error ? reject(error) : done(row))) }
    finally { await new Promise<void>((done, reject) => db.close(error => error ? reject(error) : done())) }
  }
  async function identity(id: number): Promise<string> {
    const row = await sql<{ temporal_workflow_id: string }>('SELECT temporal_workflow_id FROM executions WHERE id=?', [id])
    if (!row?.temporal_workflow_id) throw new Error('测试执行缺少 Temporal ID')
    knownIds.add(row.temporal_workflow_id)
    return row.temporal_workflow_id
  }
  async function create(workflow: Workflow): Promise<number> {
    const result = await json('/api/workflows', 'POST', workflow, 201)
    if (typeof result.id !== 'number') throw new Error('工作流 ID 无效')
    return result.id
  }
  async function execute(id: number, body: unknown): Promise<number> {
    const result = await json(`/api/workflows/${id}/execute`, 'POST', body)
    if (typeof result.executionId !== 'number') throw new Error('执行 ID 无效')
    await identity(result.executionId)
    return result.executionId
  }
  async function completed(id: number): Promise<Record<string, unknown>> {
    let result: Record<string, unknown> = {}
    await until(async () => { result = await json(`/api/executions/${id}`); return result.status !== 'running' }, `执行 ${id} 完成`)
    return result
  }
  function graph(path: string, end = 'var.amount'): Workflow {
    return { name: `进程恢复 ${path}`, variables: [{ name: 'amount', type: 'number', default: 7 }],
      nodes: [node('s', 'start'), node('http', 'http', { method: 'GET', url: `${probeBase}${path}?amount={{var.amount}}`, timeout: 20000 }), node('e', 'end', { resultExpression: end })],
      edges: [{ id: 'sh', source: 's', target: 'http' }, { id: 'he', source: 'http', target: 'e' }] }
  }
  function reply(response: ServerResponse, value: number): void {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ value }))
  }
  async function seed(workflowId: number, path: string, requestKey: string, acceptInTemporal: boolean): Promise<{ id: number; temporalId: string }> {
    const seedProcess = launch('tests/helpers/seedRecoveryExecution.ts', env, { workflowId, url: `${probeBase}${path}?amount=17`, requestKey, engineVersion: version, acceptInTemporal })
    expect(await seedProcess.exited, seedProcess.output()).toBe(0)
    const line = seedProcess.output().trim().split(/\r?\n/).at(-1)
    const value: unknown = JSON.parse(line || 'null')
    if (!record(value) || typeof value.executionId !== 'number' || typeof value.temporalWorkflowId !== 'string') throw new Error(`种子进程未返回执行：${seedProcess.output()}`)
    knownIds.add(value.temporalWorkflowId)
    expect(value.startState).toBe('pending')
    return { id: value.executionId, temporalId: value.temporalWorkflowId }
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'workflow-recovery-test-'))
    dbPath = join(directory, 'isolated.sqlite')
    const port = await freePort()
    base = `http://127.0.0.1:${port}`
    env = { ...process.env, DB_PATH: dbPath, PORT: String(port), WORKFLOW_ENGINE_VERSION: version, TEMPORAL_ADDRESS: '127.0.0.1:7233' }
    connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS })
    client = new Client({ connection, namespace: env.TEMPORAL_NAMESPACE || 'default' })
    probe = http.createServer((request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      traces.push({ path: url.pathname, value: url.searchParams.get('amount') })
      const amount = Number(url.searchParams.get('amount'))
      if (url.pathname === '/hold-worker' && !releaseWorkerRequest || url.pathname === '/hold-api' && !releaseApiRequest) {
        hanging.add(response)
        response.on('close', () => hanging.delete(response))
        if (url.pathname === '/hold-api') apiResponses.push(response)
        return
      }
      reply(response, amount)
    })
    await new Promise<void>(done => probe.listen(0, '127.0.0.1', done))
    const probeAddress = probe.address()
    if (!probeAddress || typeof probeAddress === 'string') throw new Error('故障探针端口无效')
    probeBase = `http://127.0.0.1:${probeAddress.port}`
    await startApi()
    await startWorker()
  }, 30000)

  afterAll(async () => {
    await Promise.all([...children].map(kill))
    if (client) for (const workflowId of knownIds) {
      const handle = client.workflow.getHandle(workflowId)
      try { if ((await handle.describe()).status.name === 'RUNNING') await handle.terminate('清理独立恢复测试执行') } catch { /* 仅清理本测试已知的唯一 ID。 */ }
    }
    await connection?.close()
    for (const response of hanging) response.destroy()
    if (probe) { probe.closeAllConnections(); await new Promise<void>(done => probe.close(() => done())) }
    if (directory) {
      const within = relative(resolve(directory), resolve(dbPath))
      const underTemp = relative(resolve(tmpdir()), resolve(directory))
      if (within.startsWith('..') || isAbsolute(within) || !within || underTemp.startsWith('..') || isAbsolute(underTemp) ||
        !basename(resolve(directory)).startsWith('workflow-recovery-test-')) throw new Error('拒绝清理非测试目录')
      await rm(directory, { recursive: true, force: true })
    }
  }, 15000)

  it('强杀 Worker 后继续原快照，已完成 HTTP 不重调度，在途 GET 重试', async () => {
    const initial = graph('/hold-worker')
    initial.nodes.splice(1, 0, node('first', 'http', { method: 'GET', url: `${probeBase}/first?amount={{var.amount}}` }))
    initial.edges = [{ id: 'sf', source: 's', target: 'first' }, { id: 'fh', source: 'first', target: 'http' }, { id: 'he', source: 'http', target: 'e' }]
    const workflowId = await create(initial)
    const executionId = await execute(workflowId, { variables: { amount: 42 } })
    await until(() => traces.some(trace => trace.path === '/hold-worker'), '第二个 GET 正在等待')
    await kill(worker)
    releaseWorkerRequest = true
    const edited: Workflow = { ...graph('/edited', 'var.marker'), variables: [
      { name: 'amount', type: 'number', default: 90 }, { name: 'marker', type: 'number', default: 99 }
    ] }
    await json(`/api/workflows/${workflowId}`, 'PUT', edited)
    await startWorker()
    const result = await completed(executionId)
    const attempts = Array.isArray(result.nodeRuns) ? result.nodeRuns.filter(record).filter(run => run.nodeId === 'http') : []
    console.info('Worker 重启证据', { version, executionId, result: result.result,
      firstRequests: traces.filter(trace => trace.path === '/first').length, pendingRequests: traces.filter(trace => trace.path === '/hold-worker').length,
      attempts: attempts.map(run => ({ attempt: run.attempt, status: run.status, error: run.error })) })
    expect(result.status).toBe('success')
    expect(result.result).toBe(42)
    expect(traces.filter(trace => trace.path === '/first')).toEqual([{ path: '/first', value: '42' }])
    expect(traces.filter(trace => trace.path === '/hold-worker')).toEqual([{ path: '/hold-worker', value: '42' }, { path: '/hold-worker', value: '42' }])
    expect(traces.some(trace => trace.path === '/edited')).toBe(false)
    expect(attempts.map(run => run.attempt)).toEqual([1, 2])
    expect(attempts.map(run => run.status)).toEqual(['failed', 'success'])
    const nextId = await execute(workflowId, {})
    expect((await completed(nextId)).result).toBe(99)
    expect(traces.filter(trace => trace.path === '/edited')).toEqual([{ path: '/edited', value: '90' }])
  }, 30000)

  it('SQL 已保存结果但 Activity 完成回复前强杀，重试复用结果且外部调用只有一次', async () => {
    await kill(worker)
    await startWorker('tests/helpers/crashAfterSavedResultWorker.ts')
    const workflowId = await create(graph('/saved-before-ack', 'ctx.http.output.data.value'))
    const executionId = await execute(workflowId, { variables: { amount: 64 } })
    await until(() => worker?.child.exitCode !== null || worker?.child.signalCode !== null, '故障 Worker 在结果提交后自杀')
    expect(await sql("SELECT status FROM node_runs WHERE execution_id=? AND node_id='http' AND attempt=1", [executionId])).toEqual({ status: 'success' })
    const cache = await sql<{ count: number }>('SELECT COUNT(*) AS count FROM node_results WHERE execution_id=? AND invocation_id=(SELECT invocation_id FROM node_runs WHERE execution_id=? AND node_id=\'http\' AND attempt=1)', [executionId, executionId])
    expect(cache?.count).toBe(1)
    await startWorker()
    const result = await completed(executionId)
    expect(result.status).toBe('success')
    expect(result.result).toBe(64)
    const attempts = Array.isArray(result.nodeRuns) ? result.nodeRuns.filter(record).filter(run => run.nodeId === 'http') : []
    expect(attempts.map(run => ({ attempt: run.attempt, status: run.status }))).toEqual([{ attempt: 1, status: 'success' }, { attempt: 2, status: 'success' }])
    expect(traces.filter(trace => trace.path === '/saved-before-ack')).toHaveLength(1)
    console.info('SQL 已保存但未确认窗口证据', { executionId, result: result.result, externalRequests: 1,
      attempts: attempts.map(run => ({ attempt: run.attempt, status: run.status })) })
  }, 25000)

  it('API 强杀期间 Worker 完成，同一执行 ID 以 after 和 Last-Event-ID 补传且不重复日志', async () => {
    const workflowId = await create(graph('/hold-api'))
    const executionId = await execute(workflowId, { variables: { amount: 51 } })
    await until(() => traces.some(trace => trace.path === '/hold-api'), 'API 重启前 HTTP 挂起')
    const controller = new AbortController()
    const stream = await fetch(`${base}/api/executions/${executionId}/events`, { signal: controller.signal })
    if (!stream.body) throw new Error('事件流为空')
    const reader = stream.body.getReader()
    const decoder = new TextDecoder()
    let prefix = ''
    let received: Event[] = []
    while (!received.some(event => event.type === 'state' && event.nodeId === 'http' && record(event.data) && event.data.status === 'running')) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error('事件流提前结束')
      prefix += decoder.decode(chunk.value, { stream: true })
      received = decodeEvents(prefix)
    }
    const cursor = received.at(-1)!.id
    controller.abort()
    await reader.cancel().catch(() => undefined)
    await kill(api)
    releaseApiRequest = true
    for (const response of apiResponses) if (!response.destroyed) reply(response, 51)
    const temporalId = await identity(executionId)
    await until(async () => (await client.workflow.getHandle(temporalId).describe()).status.name === 'COMPLETED', 'API 离线期间 Worker 完成')
    await startApi()
    const result = await completed(executionId)
    expect(result.status).toBe('success')
    expect(result.result).toBe(51)
    const resumedResponse = await fetch(`${base}/api/executions/${executionId}/events?after=${cursor}`, { signal: AbortSignal.timeout(5000) })
    const resumed = decodeEvents(await resumedResponse.text())
    expect(resumed.every(event => event.id > cursor)).toBe(true)
    expect(resumed.filter(event => event.type === 'completed')).toHaveLength(1)
    const fullResponse = await fetch(`${base}/api/executions/${executionId}/events`, { signal: AbortSignal.timeout(5000) })
    const all = decodeEvents(await fullResponse.text())
    expect([...received, ...resumed].map(event => event.id)).toEqual(all.map(event => event.id))
    const logs = [...received, ...resumed].filter(event => event.type === 'log')
    expect(new Set(logs.map(event => event.id)).size).toBe(logs.length)
    expect(logs.map(event => event.id)).toEqual(all.filter(event => event.type === 'log').map(event => event.id))
    const headerResponse = await fetch(`${base}/api/executions/${executionId}/events?after=0`, { headers: { 'Last-Event-ID': String(cursor) }, signal: AbortSignal.timeout(5000) })
    expect(decodeEvents(await headerResponse.text()).map(event => event.id)).toEqual(resumed.map(event => event.id))
    expect(traces.filter(trace => trace.path === '/hold-api')).toHaveLength(1)
    console.info('API 重启与 SSE 证据', { executionId, cursor, previousEvents: received.length, resumedEvents: resumed.length,
      allEvents: all.length, logEvents: logs.length, httpRequests: traces.filter(trace => trace.path === '/hold-api').length, result: result.result })
  }, 20000)

  it('API 重启校正 pending 和已接受未确认窗口，请求标识稳定复用且不重复启动', async () => {
    const pendingGraph = graph('/seed-pending', 'ctx.http.output.data.value')
    const acceptedGraph = graph('/seed-accepted', 'ctx.http.output.data.value')
    pendingGraph.variables = [{ name: 'amount', type: 'number', default: 17 }]
    acceptedGraph.variables = [{ name: 'amount', type: 'number', default: 17 }]
    const workflowId = await create(pendingGraph)
    const acceptedWorkflowId = await create(acceptedGraph)
    await kill(api)
    const pendingKey = `recovery-pending-${randomUUID()}`
    const acceptedKey = `recovery-accepted-${randomUUID()}`
    const pending = await seed(workflowId, '/seed-pending', pendingKey, false)
    const accepted = await seed(acceptedWorkflowId, '/seed-accepted', acceptedKey, true)
    await expect(client.workflow.getHandle(pending.temporalId).describe()).rejects.toThrow('workflow not found')
    const acceptedRun = await client.workflow.getHandle(accepted.temporalId).describe()
    await startApi()
    // 不先 GET /executions，避免查询入口的同步逻辑掩盖后台校正器失效。
    await until(async () => {
      const row = await sql<{ completed: number }>("SELECT COUNT(*) AS completed FROM executions WHERE id IN (?,?) AND start_state='started' AND status='success'", [pending.id, accepted.id])
      return row?.completed === 2
    }, 'API 后台校正器独立恢复两种启动窗口')
    expect((await completed(pending.id)).result).toBe(17)
    expect((await completed(accepted.id)).result).toBe(17)
    const pendingRun = await client.workflow.getHandle(pending.temporalId).describe()
    expect((await client.workflow.getHandle(accepted.temporalId).describe()).runId).toBe(acceptedRun.runId)
    expect(await execute(workflowId, { requestId: pendingKey })).toBe(pending.id)
    expect(await execute(acceptedWorkflowId, { requestId: acceptedKey })).toBe(accepted.id)
    await kill(api)
    await startApi()
    await completed(pending.id)
    expect((await client.workflow.getHandle(pending.temporalId).describe()).runId).toBe(pendingRun.runId)
    expect(traces.filter(trace => trace.path === '/seed-pending')).toHaveLength(1)
    expect(traces.filter(trace => trace.path === '/seed-accepted')).toHaveLength(1)
    expect(await sql('SELECT COUNT(*) AS count FROM executions WHERE request_key=?', [pendingKey])).toEqual({ count: 1 })
    expect(await sql('SELECT COUNT(*) AS count FROM executions WHERE request_key=?', [acceptedKey])).toEqual({ count: 1 })
    console.info('启动窗口恢复证据', { pendingExecutionId: pending.id, pendingWorkflowId: pending.temporalId,
      pendingRunId: pendingRun.runId, acceptedExecutionId: accepted.id, acceptedWorkflowId: accepted.temporalId,
      acceptedRunId: acceptedRun.runId, pendingRequests: traces.filter(trace => trace.path === '/seed-pending').length,
      acceptedRequests: traces.filter(trace => trace.path === '/seed-accepted').length })
  }, 25000)
  it('Temporal不可用时返回待确认执行与明确提示，不运行旧引擎', async () => {
    await kill(api)
    const original = env.TEMPORAL_ADDRESS
    env.TEMPORAL_ADDRESS = `127.0.0.1:${await freePort()}`
    try {
      await startApi()
      const workflowId = await create(graph('/offline'))
      const started = await json(`/api/workflows/${workflowId}/execute`, 'POST', {}, 503)
      expect(started.message).toContain('暂未确认')
      if (typeof started.executionId !== 'number') throw new Error('未返回待确认执行ID')
      await identity(started.executionId)
      const saved = await json(`/api/executions/${started.executionId}`)
      expect(saved.start_state).toBe('pending')
      expect(saved.sync_warning).toContain('Temporal')
      expect(saved.nodeRuns).toEqual([])
      expect(traces.filter(trace => trace.path === '/offline')).toHaveLength(0)
    } finally { await kill(api); env.TEMPORAL_ADDRESS = original }
  }, 15000)
})
