import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import supertest from 'supertest'
import { createHash, randomUUID } from 'node:crypto'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { Worker, bundleWorkflowCode } from '@temporalio/worker'
import { MockActivityEnvironment, TestWorkflowEnvironment } from '@temporalio/testing'
import * as activities from '../src/temporal/activities.js'
import { db, initializeDb } from '../src/db/index.js'
import * as store from '../src/services/executionStore.js'
import { createApp } from '../src/app.js'
import { closeTemporalClient } from '../src/temporal/client.js'
import { taskQueueFor } from '../src/temporal/config.js'
import type { Execution, NodeConfig, Workflow } from '../src/types/index.js'
import type { NodeCall } from '../src/temporal/contracts.js'

const version = `control-${randomUUID()}`
process.env.WORKFLOW_ENGINE_VERSION = version
const app = createApp()
let environment: TestWorkflowEnvironment
let worker: Worker
let running: Promise<void>
let loseCompletionReply = false, completionAttempts = 0

function node(id: string, type: string, data: NodeConfig = {}) { return { id, type, position: { x: 0, y: 0 }, data } }
function edge(source: string, target: string, label?: string) { return { id: `${source}-${target}`, source, target, ...(label ? { label } : {}) } }

async function execute(workflow: Workflow, variables: Record<string, unknown>, started?: (executionId: number, workflowId: string) => void): Promise<Execution> {
  const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
  const startResponse = await supertest(app).post(`/api/workflows/${created.body.id}/execute`).send({ variables }).expect(200)
  if (started) {
    const initial = await supertest(app).get(`/api/executions/${startResponse.body.executionId}`).expect(200)
    started(startResponse.body.executionId, initial.body.temporal_workflow_id)
  }
  for (let i = 0; i < 300; i++) {
    const response = await supertest(app).get(`/api/executions/${startResponse.body.executionId}`).expect(200)
    if (response.body.status !== 'running') return response.body
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('控制流测试执行未结束')
}

beforeAll(async () => {
  await initializeDb()
  environment = await TestWorkflowEnvironment.createFromExistingServer({ address: '127.0.0.1:7233' })
  const workflowBundle = await bundleWorkflowCode({ workflowsPath: fileURLToPath(new URL('../src/temporal/workflows.ts', import.meta.url)) })
  worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: taskQueueFor(version), workflowBundle, activities: {
    ...activities,
    completeControlActivity: async input => {
      completionAttempts++
      const result = await activities.completeControlActivity(input)
      if (loseCompletionReply) { loseCompletionReply = false; throw new Error('模拟汇总已提交但完成回复丢失') }
      return result
    }
  } })
  running = worker.run()
}, 60000)
afterAll(async () => { worker?.shutdown(); await running; await closeTemporalClient(); await environment?.teardown() })

describe('真实 Temporal 循环与独立作用域', () => {
  const ordinary: Workflow = { name: '普通循环', nodes: [node('s', 'start'), node('loop', 'loop', { iteratorExpression: 'var.values' }), node('body', 'end', { resultExpression: 'var.item' }), node('next', 'end', { resultExpression: 'ctx.loop.output' })], edges: [edge('s', 'loop'), edge('loop', 'body', 'body'), edge('loop', 'next', 'next')] }
  it('逐项执行并汇总，next 只执行一次且每轮调用可区分', async () => {
    const execution = await execute(ordinary, { values: [1, 2, 3] })
    expect(execution.status).toBe('success')
    expect(execution.result).toEqual([1, 2, 3])
    const body = execution.nodeRuns?.filter(run => run.nodeId === 'body') || []
    expect(body.map(run => run.output)).toEqual([1, 2, 3])
    expect(new Set(body.map(run => run.invocationId)).size).toBe(3)
    expect(new Set(body.map(run => run.scopePath)).size).toBe(3)
    expect(execution.nodeRuns?.filter(run => run.nodeId === 'next')).toHaveLength(1)
  }, 30000)
  it('空数组跳过 body 并继续 next', async () => {
    const execution = await execute(ordinary, { values: [] })
    expect(execution).toMatchObject({ status: 'success', result: [] })
    expect(execution.nodeRuns?.some(run => run.nodeId === 'body')).toBe(false)
  }, 30000)
  it('嵌套循环保留外层元素，body 状态不泄漏到父上下文', async () => {
    const workflow: Workflow = { name: '嵌套循环', nodes: [node('s', 'start'), node('outer', 'loop', { iteratorExpression: 'var.values' }), node('inner', 'loop', { iteratorExpression: 'var.item.children' }), node('child', 'end', { resultExpression: 'var.item' }), node('outerEnd', 'end', { resultExpression: 'var.item.name' }), node('next', 'end', { resultExpression: 'ctx.outer.output' })], edges: [edge('s', 'outer'), edge('outer', 'inner', 'body'), edge('outer', 'next', 'next'), edge('inner', 'child', 'body'), edge('inner', 'outerEnd', 'next')] }
    const execution = await execute(workflow, { values: [{ name: '甲', children: [1, 2] }, { name: '乙', children: [3] }] })
    expect(execution).toMatchObject({ status: 'success', result: ['甲', '乙'] })
    expect(execution.nodeRuns?.filter(run => run.nodeId === 'child').map(run => run.output)).toEqual([1, 2, 3])
    expect(execution.nodeRuns?.filter(run => run.nodeId === 'next')[0]?.input).toEqual({ outer: ['甲', '乙'] })
  }, 30000)
  it('不可迭代输入与循环体失败让控制节点也进入终态', async () => {
    const invalid = await execute(ordinary, { values: 42 })
    expect(invalid.status).toBe('failed')
    expect(invalid.context.loop?.status).toBe('failed')
    const workflow: Workflow = { ...ordinary, name: '循环体错误', nodes: ordinary.nodes.map(item => item.id === 'body' ? node('body', 'branch', { condition: 'throw new Error("失败")' }) : item).concat([node('yes', 'end'), node('no', 'end')]), edges: ordinary.edges.concat([edge('body', 'yes', 'true'), edge('body', 'no', 'false')]) }
    const failed = await execute(workflow, { values: [1] })
    expect(failed.status).toBe('failed')
    expect(failed.context.loop?.status).toBe('failed')
  }, 30000)
  it('汇总提交后的回复丢失只重试汇总，不重复循环体外部写入', async () => {
    let writes = 0
    const service = http.createServer((_request, response) => { writes++; response.setHeader('content-type', 'application/json'); response.end('{"value":7}') })
    await new Promise<void>(resolve => service.listen(0, '127.0.0.1', resolve))
    const address = service.address()
    if (!address || typeof address === 'string') throw new Error('测试服务端口缺失')
    try {
      const workflow: Workflow = { name: '循环缓存恢复', nodes: [node('s', 'start'), node('loop', 'loop', { iteratorExpression: 'var.values' }), node('write', 'http', { method: 'POST', url: `http://127.0.0.1:${address.port}` }), node('body', 'end', { resultExpression: 'ctx.write.output.data.value' }), node('next', 'end', { resultExpression: 'ctx.loop.output' })], edges: [edge('s', 'loop'), edge('loop', 'write', 'body'), edge('write', 'body'), edge('loop', 'next', 'next')] }
      completionAttempts = 0; loseCompletionReply = true
      const execution = await execute(workflow, { values: [1, 2] })
      expect(execution).toMatchObject({ status: 'success', result: [7, 7] })
      expect(completionAttempts).toBe(2)
      expect(writes).toBe(2)
      expect(execution.nodeRuns?.filter(run => run.nodeId === 'loop')).toHaveLength(1)
    } finally { loseCompletionReply = false; await new Promise<void>(resolve => service.close(() => resolve())) }
  }, 30000)
  it('准备重试复用迭代引用，最终完成覆盖准备缓存并恢复准确的节点 input', async () => {
    const row = await store.createExecution(ordinary, { values: ['甲', '乙'] }, version, { maxNodeCalls: 20, maxOutputBytes: 1000 })
    const call: NodeCall = { executionId: row.id, nodeId: 'loop', invocationId: 'loop-preparation', scopePath: 'root', sequence: 1, contextRef: null, locals: {} }
    const prepared = await new MockActivityEnvironment().run(activities.executeNodeActivity, call)
    await db.run('UPDATE executions SET variables_snapshot=? WHERE id=?', [JSON.stringify({ values: ['修改后'] }), row.id])
    const retry = await new MockActivityEnvironment({ attempt: 2 }).run(activities.executeNodeActivity, call)
    expect(retry).toEqual(prepared)
    expect(prepared.outputRef).toBeUndefined()
    expect((await store.readExecution(row.id))?.context.loop?.status).toBe('running')
    const refs = prepared.items || []
    expect(await Promise.all(refs.map(ref => store.readValue(ref, row.id)))).toEqual(['甲', '乙'])
    const final = await new MockActivityEnvironment().run(activities.completeControlActivity, { call, resultRefs: refs })
    expect(await store.readValue(final.outputRef || '', row.id)).toEqual(['甲', '乙'])
    expect(await store.getNodeResult(row.id, call.invocationId)).toEqual(final)
    const outputCall: NodeCall = { ...call, nodeId: 'body', invocationId: 'input-source', sequence: 2 }
    await store.prepareNodeRun(outputCall, 1, { expected: '准确输入' })
    const source = await store.completeNodeRun(outputCall, 1, 1, {})
    const otherCall = { ...outputCall, invocationId: 'other-scope' }
    await store.prepareNodeRun(otherCall, 1, { expected: '其他作用域' })
    const later = await store.completeNodeRun(otherCall, 1, 2, {})
    expect(later.outputRef).not.toBe(source.outputRef)
    expect(await store.readNodeInputForOutput(row.id, source.outputRef || '')).toEqual({ expected: '准确输入' })
  })
  it('循环和并行共享全局调用预算，控制准备与汇总只计一次', async () => {
    process.env.WORKFLOW_MAX_NODE_CALLS = '5'
    try {
      expect(await execute(ordinary, { values: [1, 2] })).toMatchObject({ status: 'success', result: [1, 2] })
      const tooMany = await execute(ordinary, { values: [1, 2, 3, 4] })
      expect(tooMany.status).toBe('failed')
      expect(tooMany.nodeRuns?.some(run => run.nodeId === 'body')).toBe(false)
      const parallel: Workflow = { name: '共享预算', nodes: [node('s', 'start'), node('p', 'parallel'), node('a', 'end'), node('b', 'end'), node('join', 'end')], edges: [edge('s', 'p'), edge('p', 'a', 'fork-0'), edge('p', 'b', 'fork-1'), edge('p', 'join', 'join')] }
      expect((await execute(parallel, {})).status).toBe('success')
      process.env.WORKFLOW_MAX_NODE_CALLS = '4'
      const exhausted = await execute(parallel, {})
      expect(exhausted.status).toBe('failed')
      expect(exhausted.nodeRuns).toHaveLength(4)
    } finally { delete process.env.WORKFLOW_MAX_NODE_CALLS }
  }, 30000)
  it('聚合及循环元素按 UTF8 限额提前拒绝，损坏快照是不可重试错误', async () => {
    const row = await store.createExecution(ordinary, { values: ['河', '河'] }, version, { maxNodeCalls: 20, maxOutputBytes: 12 })
    const call: NodeCall = { executionId: row.id, nodeId: 'loop', invocationId: 'limited-loop', scopePath: 'root', sequence: 1, contextRef: null, locals: {} }
    await expect(new MockActivityEnvironment().run(activities.executeNodeActivity, call)).rejects.toMatchObject({ nonRetryable: true, type: 'OutputLimitExceeded' })
    expect((await store.readExecution(row.id))?.nodeRuns?.[0]?.status).toBe('failed')
    const aggregate = await store.createExecution(ordinary, { values: [] }, version, { maxNodeCalls: 20, maxOutputBytes: 12 })
    const aggregateCall = { ...call, executionId: aggregate.id }
    await new MockActivityEnvironment().run(activities.executeNodeActivity, aggregateCall)
    const refs = await Promise.all(['河', '河'].map(value => store.writeValue(aggregate.id, value)))
    await expect(new MockActivityEnvironment().run(activities.completeControlActivity, { call: aggregateCall, resultRefs: refs })).rejects.toMatchObject({ nonRetryable: true, type: 'OutputLimitExceeded' })
    await db.run('UPDATE executions SET workflow_snapshot=? WHERE id=?', ['{损坏', row.id])
    await expect(activities.loadExecutionPlan(row.id, version)).rejects.toMatchObject({ nonRetryable: true, type: 'InvalidExecutionSnapshot' })
  })
  it('汇总遇临时数据库故障重试成功后清除中间错误', async () => {
    const row = await store.createExecution(ordinary, { values: [7] }, version, { maxNodeCalls: 20, maxOutputBytes: 1000 })
    const call: NodeCall = { executionId: row.id, nodeId: 'loop', invocationId: 'transient-completion', scopePath: 'root', sequence: 1, contextRef: null, locals: {} }
    const prepared = await new MockActivityEnvironment().run(activities.executeNodeActivity, call)
    await db.exec("CREATE TEMP TRIGGER reject_control_completion BEFORE UPDATE ON node_results BEGIN SELECT RAISE(ABORT,'临时写入失败'); END;")
    try {
      await expect(new MockActivityEnvironment().run(activities.completeControlActivity, { call, resultRefs: prepared.items || [] })).rejects.toThrow('临时写入失败')
    } finally { await db.exec('DROP TRIGGER reject_control_completion') }
    expect((await store.readExecution(row.id))?.context.loop?.status).toBe('running')
    await new MockActivityEnvironment({ attempt: 2 }).run(activities.completeControlActivity, { call, resultRefs: prepared.items || [] })
    const run = (await store.readExecution(row.id))?.nodeRuns?.[0]
    expect(run?.status).toBe('success')
    expect(run?.error).toBeUndefined()
  })
})

describe('真实 Temporal 并行与取消', () => {
  it('并发请求按 fork 编号汇总，循环和临时变量独立且 join 只运行一次', async () => {
    let active = 0, maximum = 0
    const service = http.createServer((request, response) => {
      active++; maximum = Math.max(maximum, active)
      setTimeout(() => { active--; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ route: request.url })) }, 100)
    })
    await new Promise<void>(resolve => service.listen(0, '127.0.0.1', resolve))
    const address = service.address()
    if (!address || typeof address === 'string') throw new Error('测试服务端口缺失')
    const url = `http://127.0.0.1:${address.port}`
    try {
      const workflow: Workflow = { name: '并行循环', nodes: [node('s', 'start'), node('p', 'parallel'), node('a', 'http', { url: `${url}/a` }), node('b', 'http', { url: `${url}/b` }), node('loop', 'loop', { iteratorExpression: 'var.values' }), node('item', 'end', { resultExpression: 'var.item' }), node('aEnd', 'end', { resultExpression: 'ctx.loop.output' }), node('bEnd', 'end', { resultExpression: 'var.item' }), node('join', 'end', { resultExpression: 'ctx.p.output' })], edges: [edge('s', 'p'), edge('p', 'a', 'fork-10'), edge('p', 'b', 'fork-2'), edge('p', 'join', 'join'), edge('a', 'loop'), edge('loop', 'item', 'body'), edge('loop', 'aEnd', 'next'), edge('b', 'bEnd')] }
      const execution = await execute(workflow, { values: [1, 2], item: '父元素' })
      expect(execution).toMatchObject({ status: 'success', result: { 'fork-2': '父元素', 'fork-10': [1, 2] } })
      expect(maximum).toBe(2)
      expect(execution.nodeRuns?.filter(run => run.nodeId === 'join')).toHaveLength(1)
      expect(execution.nodeRuns?.find(run => run.nodeId === 'b')?.scopePath).toContain('/p/fork-2')
      expect(execution.nodeRuns?.find(run => run.nodeId === 'aEnd')?.input).toEqual({ loop: [1, 2] })
    } finally { await new Promise<void>(resolve => service.close(() => resolve())) }
  }, 30000)

  it('Python 最终失败取消进行中的 HTTP，等待连接关闭且保留各节点实际状态', async () => {
    let connected = false, closed = false
    const service = http.createServer((_request, response) => { connected = true; response.on('close', () => { closed = true }) })
    await new Promise<void>(resolve => service.listen(0, '127.0.0.1', resolve))
    const address = service.address()
    if (!address || typeof address === 'string') throw new Error('测试服务端口缺失')
    try {
      const workflow: Workflow = { name: 'Python取消HTTP', nodes: [node('s', 'start'), node('p', 'parallel'), node('py', 'python', { code: 'import time\ntime.sleep(0.4)\nraise ValueError("并行失败")', retry: { maxAttempts: 1 } }), node('request', 'http', { url: `http://127.0.0.1:${address.port}`, timeout: 20000 }), node('pyEnd', 'end'), node('httpEnd', 'end'), node('join', 'end')], edges: [edge('s', 'p'), edge('p', 'py', 'fork-0'), edge('p', 'request', 'fork-1'), edge('p', 'join', 'join'), edge('py', 'pyEnd'), edge('request', 'httpEnd')] }
      const execution = await execute(workflow, {})
      expect(connected).toBe(true)
      expect(execution.status).toBe('failed')
      expect(closed).toBe(true)
      expect(execution.context.py?.status).toBe('failed')
      expect(execution.context.request?.status).toBe('stopped')
      expect(execution.context.p?.status).toBe('failed')
      expect(execution.nodeRuns?.some(run => run.nodeId === 'join')).toBe(false)
    } finally { service.closeAllConnections(); await new Promise<void>(resolve => service.close(() => resolve())) }
  }, 30000)

  it('HTTP 最终失败等待 Python 容器删除，保留已完成外部写入', async () => {
    const docker = promisify(execFile)
    let sandboxName = '', pythonWasRunning = false, writes = 0, executionId = 0, temporalId = ''
    const service = http.createServer((request, response) => {
      if (request.url === '/write') { writes++; response.end('{}'); return }
      void (async () => {
        for (let i = 0; i < 100; i++) {
          if (executionId && !sandboxName) {
            const pythonRun = (await store.readExecution(executionId))?.nodeRuns?.find(run => run.nodeId === 'py')
            if (pythonRun) sandboxName = `workflow-python-${createHash('sha256').update(`${temporalId}:${executionId}:${pythonRun.invocationId}`).digest('hex').slice(0, 40)}`
          }
          if (sandboxName && writes === 1) {
            const { stdout } = await docker('docker', ['ps', '-q', '--filter', `name=^/${sandboxName}$`], { windowsHide: true })
            if (stdout.trim()) { pythonWasRunning = true; break }
          }
          await new Promise(resolve => setTimeout(resolve, 40))
        }
        response.statusCode = 404; response.end('{}')
      })().catch(error => { response.statusCode = 500; response.end(String(error)) })
    })
    await new Promise<void>(resolve => service.listen(0, '127.0.0.1', resolve))
    const address = service.address()
    if (!address || typeof address === 'string') throw new Error('测试服务端口缺失')
    const url = `http://127.0.0.1:${address.port}`
    try {
      const workflow: Workflow = { name: 'HTTP取消Python', nodes: [node('s', 'start'), node('p', 'parallel'), node('fail', 'http', { url: `${url}/fail` }), node('loop', 'loop', { iteratorExpression: 'var.values' }), node('py', 'python', { code: 'import time\ntime.sleep(15)\nOUTPUT = 1', timeout: 20000 }), node('write', 'http', { method: 'POST', url: `${url}/write` }), node('failEnd', 'end'), node('pyEnd', 'end'), node('loopEnd', 'end'), node('writeEnd', 'end'), node('join', 'end')], edges: [edge('s', 'p'), edge('p', 'fail', 'fork-0'), edge('p', 'loop', 'fork-1'), edge('p', 'write', 'fork-2'), edge('p', 'join', 'join'), edge('fail', 'failEnd'), edge('loop', 'py', 'body'), edge('loop', 'loopEnd', 'next'), edge('py', 'pyEnd'), edge('write', 'writeEnd')] }
      const execution = await execute(workflow, { values: [1] }, (id, workflowId) => { executionId = id; temporalId = workflowId })
      expect(pythonWasRunning).toBe(true)
      expect(execution.status).toBe('failed')
      expect(execution.context.py?.status).toBe('stopped')
      expect(execution.context.loop?.status).toBe('stopped')
      expect(execution.context.write?.status).toBe('success')
      expect(writes).toBe(1)
      const { stdout } = await docker('docker', ['ps', '-aq', '--filter', `name=^/${sandboxName}$`], { windowsHide: true })
      expect(stdout.trim()).toBe('')
    } finally { service.closeAllConnections(); await new Promise<void>(resolve => service.close(() => resolve())) }
  }, 30000)
})

describe('可导入控制流示例', () => {
  const examples: { filename: string; variables: Record<string, unknown>; expected: unknown }[] = [
    { filename: 'temporal-loop-workflow.json', variables: {}, expected: [1, 2, 3] },
    { filename: 'temporal-loop-workflow.json', variables: { values: [] }, expected: [] },
    { filename: 'temporal-nested-loop-workflow.json', variables: {}, expected: [[1, 2], [3]] },
    { filename: 'temporal-parallel-workflow.json', variables: {}, expected: { 'fork-0': 1, 'fork-1': 2 } }
  ]
  it.each(examples)('$filename 默认与覆盖输入：$expected', async ({ filename, variables, expected }) => {
    const workflow: Workflow = JSON.parse(readFileSync(new URL(`../../examples/${filename}`, import.meta.url), 'utf8'))
    expect(await execute(workflow, variables)).toMatchObject({ status: 'success', result: expected })
  }, 30000)
})
