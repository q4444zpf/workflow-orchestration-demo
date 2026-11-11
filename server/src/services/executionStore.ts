import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'
import type { Execution, ExecutionContext, ExecutionLog, FlowEdge, FlowNode, NodeConfig, NodeExecutionState, NodeRun, Workflow, WorkflowVariable } from '../types/index.js'
import type { ExecutionLimits, NodeCall, NodeTaskResult } from '../temporal/contracts.js'
import { isRequestValue } from '../shared/requestValues.js'

export interface ExecutionRow {
  id: number
  workflow_id: number
  status: Execution['status']
  context: string | null
  logs: string | null
  result: string | null
  started_at: string | null
  ended_at: string | null
  temporal_workflow_id: string | null
  engine_version: string | null
  start_state: string
  request_key: string | null
  workflow_snapshot: string | null
  variables_snapshot: string | null
  limits_snapshot: string | null
  result_ref: string | null
  completion_status: string | null
  completion_error: string | null
}

interface NodeRunRow {
  id: number; execution_id: number; invocation_id: string; node_id: string; scope_path: string
  sequence: number; attempt: number; status: NodeRun['status']; input_ref: string | null; output_ref: string | null
  started_at: string; ended_at: string | null; error: string | null
}
export interface StoredExecutionEvent { id: number; type: string; nodeId: string; data?: unknown }
type CompletionStatus = 'success' | 'failed' | 'stopped'

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isStringMap = (value: unknown): value is Record<string, string> => isRecord(value) && Object.values(value).every(item => typeof item === 'string')
const parse = (value: string): unknown => JSON.parse(value)
const encode = (value: unknown): string => JSON.stringify(value) ?? 'null'

export class StoredExecutionDataError extends Error {}

function isNodeConfig(value: unknown): value is NodeConfig {
  if (!isRecord(value)) return false
  const stringFields = ['label', 'resultExpression', 'url', 'code', 'outputVar', 'condition', 'iteratorExpression']
  if (stringFields.some(key => value[key] !== undefined && typeof value[key] !== 'string')) return false
  if (['inputMapping', 'outputMapping', 'resultMapping', 'headers'].some(key => value[key] !== undefined && !isStringMap(value[key]))) return false
  if (value.timeout !== undefined && typeof value.timeout !== 'number') return false
  if (value.requestBody !== undefined && !isRequestValue(value.requestBody)) return false
  if (['requestQuery', 'requestHeaders'].some(key => value[key] !== undefined && (!isRecord(value[key]) || !Object.values(value[key]).every(item => isRequestValue(item))))) return false
  return value.method === undefined || value.method === 'GET' || value.method === 'POST' || value.method === 'PUT' || value.method === 'DELETE'
}
function isNode(value: unknown): value is FlowNode {
  return isRecord(value) && typeof value.id === 'string' && typeof value.type === 'string' &&
    isRecord(value.position) && typeof value.position.x === 'number' && typeof value.position.y === 'number' && isNodeConfig(value.data)
}
function isEdge(value: unknown): value is FlowEdge {
  return isRecord(value) && typeof value.id === 'string' && typeof value.source === 'string' && typeof value.target === 'string' &&
    (value.label === undefined || typeof value.label === 'string')
}
function isVariable(value: unknown): value is WorkflowVariable {
  return isRecord(value) && typeof value.name === 'string' &&
    ['string', 'number', 'boolean', 'array', 'object'].some(type => type === value.type) &&
    (value.description === undefined || typeof value.description === 'string')
}
function isWorkflow(value: unknown): value is Workflow {
  return isRecord(value) && typeof value.name === 'string' && Array.isArray(value.nodes) && value.nodes.every(isNode) &&
    Array.isArray(value.edges) && value.edges.every(isEdge) &&
    (value.variables === undefined || Array.isArray(value.variables) && value.variables.every(isVariable))
}
function isLimits(value: unknown): value is ExecutionLimits {
  return isRecord(value) && Number.isSafeInteger(value.maxOutputBytes) && typeof value.maxOutputBytes === 'number' && value.maxOutputBytes > 0 &&
    Number.isSafeInteger(value.maxNodeCalls) && typeof value.maxNodeCalls === 'number' && value.maxNodeCalls > 0
}
function isNodeState(value: unknown): value is NodeExecutionState {
  return isRecord(value) && ['pending', 'running', 'success', 'failed', 'stopped'].some(status => status === value.status)
}
function isLog(value: unknown): value is ExecutionLog {
  return isRecord(value) && typeof value.time === 'string' && typeof value.nodeId === 'string' && typeof value.message === 'string' &&
    ['info', 'error', 'debug'].some(level => level === value.level)
}
function decodeNodeResult(value: unknown): NodeTaskResult {
  if (!isRecord(value) || (value.contextRef !== null && typeof value.contextRef !== 'string') ||
    (value.outputRef !== undefined && typeof value.outputRef !== 'string') ||
    (value.route !== undefined && typeof value.route !== 'string') ||
    (value.items !== undefined && (!Array.isArray(value.items) || !value.items.every(item => typeof item === 'string')))) {
    throw new Error('节点结果引用损坏')
  }
  return { contextRef: value.contextRef, ...(typeof value.outputRef === 'string' ? { outputRef: value.outputRef } : {}),
    ...(typeof value.route === 'string' ? { route: value.route } : {}),
    ...(Array.isArray(value.items) && value.items.every((item): item is string => typeof item === 'string') ? { items: value.items } : {}) }
}

export async function createExecution(workflow: Workflow, variables: Record<string, unknown>, engineVersion: string, limits: ExecutionLimits, requestKey?: string): Promise<ExecutionRow> {
  if (!isLimits(limits)) throw new Error('执行限额必须为正整数')
  // 在首次 await 前序列化，调用者后续修改对象不会改变启动快照。
  const snapshot = encode(workflow), inputs = encode(variables), frozenLimits = encode(limits)
  return db.transaction(async () => {
    if (requestKey !== undefined) {
      const existing = await db.get<ExecutionRow>('SELECT * FROM executions WHERE request_key = ?', [requestKey])
      if (existing) return existing
    }
    const result = await db.run(`INSERT INTO executions
      (workflow_id,status,context,logs,result,started_at,engine_version,start_state,request_key,workflow_snapshot,variables_snapshot,limits_snapshot)
      VALUES (?,'running','{}','[]','null',? ,?,'pending',?,?,?,?)`,
    [workflow.id ?? 0, new Date().toISOString(), engineVersion, requestKey ?? null, snapshot, inputs, frozenLimits])
    await db.run('UPDATE executions SET temporal_workflow_id=? WHERE id=?', [`workflow-execution-${result.lastID}-${randomUUID()}`, result.lastID])
    const row = await getExecutionRow(result.lastID)
    if (!row) throw new Error('执行记录创建失败')
    return row
  })
}

export async function getExecutionRow(id: number): Promise<ExecutionRow | undefined> {
  return db.get<ExecutionRow>('SELECT * FROM executions WHERE id=?', [id])
}
export async function getExecutionSnapshot(id: number): Promise<{ id: number; workflow: Workflow; variables: Record<string, unknown>; engineVersion: string; limits: ExecutionLimits }> {
  const row = await getExecutionRow(id)
  if (!row?.workflow_snapshot || !row.variables_snapshot || !row.engine_version || !row.limits_snapshot) throw new StoredExecutionDataError(`执行 ${id} 没有 Temporal 快照`)
  let workflow: unknown, variables: unknown, limits: unknown
  try { workflow = parse(row.workflow_snapshot); variables = parse(row.variables_snapshot); limits = parse(row.limits_snapshot) }
  catch { throw new StoredExecutionDataError(`执行 ${id} 的快照损坏`) }
  if (!isWorkflow(workflow) || !isRecord(variables) || !isLimits(limits)) throw new StoredExecutionDataError(`执行 ${id} 的快照损坏`)
  return { id, workflow, variables, engineVersion: row.engine_version, limits }
}
export async function listActiveExecutions(): Promise<ExecutionRow[]> {
  return db.all<ExecutionRow>("SELECT * FROM executions WHERE status='running' AND temporal_workflow_id IS NOT NULL ORDER BY id")
}
export async function markExecutionStarted(id: number): Promise<void> {
  await db.run("UPDATE executions SET start_state='started' WHERE id=? AND temporal_workflow_id IS NOT NULL", [id])
}

function ownerFromRef(ref: string, executionId?: number): number {
  const match = /^execution:(\d+):[0-9a-f-]+$/.exec(ref)
  const owner = match ? Number(match[1]) : NaN
  if (!Number.isSafeInteger(owner) || (executionId !== undefined && owner !== executionId)) throw new Error('值引用归属不匹配')
  return owner
}
async function writeStoredValue(executionId: number, kind: 'value' | 'context', value: unknown): Promise<string> {
  const ref = `execution:${executionId}:${randomUUID()}`
  await db.run('INSERT INTO execution_values(ref,execution_id,kind,data) VALUES(?,?,?,?)', [ref, executionId, kind, encode(value)])
  return ref
}
async function readStoredValue(ref: string, kind: 'value' | 'context', executionId?: number): Promise<unknown> {
  const owner = ownerFromRef(ref, executionId)
  const row = await db.get<{ data: string }>('SELECT data FROM execution_values WHERE ref=? AND execution_id=? AND kind=?', [ref, owner, kind])
  if (!row) throw new Error('值引用不存在或归属不匹配')
  return parse(row.data)
}
export async function writeValue(executionId: number, value: unknown): Promise<string> { return writeStoredValue(executionId, 'value', value) }
export async function readValue(ref: string, executionId?: number): Promise<unknown> { return readStoredValue(ref, 'value', executionId) }
export async function writeContextReferences(executionId: number, refs: Record<string, string>): Promise<string> {
  for (const ref of Object.values(refs)) await readValue(ref, executionId)
  return writeStoredValue(executionId, 'context', refs)
}
export async function readContextReferences(executionId: number, contextRef: string | null): Promise<Record<string, string>> {
  if (contextRef === null) return {}
  const value = await readStoredValue(contextRef, 'context', executionId)
  if (!isStringMap(value)) throw new Error('执行上下文引用损坏')
  for (const ref of Object.values(value)) ownerFromRef(ref, executionId)
  return value
}

// 输入必须沿相同输出引用恢复，不能读取并行其他作用域的最新一次调用。
export async function readNodeInputForOutput(executionId: number, outputRef: string): Promise<unknown> {
  const row = await db.get<{ input_ref: string | null }>('SELECT input_ref FROM node_runs WHERE execution_id=? AND output_ref=? AND status=\'success\' ORDER BY id LIMIT 1', [executionId, outputRef])
  return row?.input_ref ? readValue(row.input_ref, executionId) : null
}

async function assertExecutionOpen(id: number): Promise<void> {
  const row = await getExecutionRow(id)
  if (!row || row.status !== 'running' || row.completion_status !== null) throw new StoredExecutionDataError('执行已经结束，拒绝迟到的节点写入')
}

async function latestNodeRun(call: NodeCall): Promise<NodeRunRow | undefined> {
  return db.get<NodeRunRow>('SELECT * FROM node_runs WHERE execution_id=? AND invocation_id=? ORDER BY attempt DESC LIMIT 1', [call.executionId, call.invocationId])
}

async function assertCurrentAttempt(call: NodeCall, attempt: number): Promise<NodeRunRow | undefined> {
  await assertExecutionOpen(call.executionId)
  const latest = await latestNodeRun(call)
  if (latest && latest.attempt > attempt) throw new StoredExecutionDataError('节点尝试已经过期，拒绝覆盖较新的尝试')
  return latest?.attempt === attempt ? latest : undefined
}

export async function cacheControlPreparation(call: NodeCall, items?: unknown[], attempt?: number): Promise<NodeTaskResult> {
  return db.transaction(async () => {
    await assertExecutionOpen(call.executionId)
    const current = await latestNodeRun(call)
    if (attempt !== undefined && current && current.attempt > attempt || current && current.status !== 'running') throw new StoredExecutionDataError('控制节点准备尝试已结束或过期')
    const cached = await getNodeResult(call.executionId, call.invocationId)
    if (cached) return cached
    const itemRefs: string[] = []
    if (items) for (const item of items) itemRefs.push(await writeValue(call.executionId, item))
    const result: NodeTaskResult = { contextRef: call.contextRef, ...(items ? { items: itemRefs } : {}) }
    await db.run('INSERT INTO node_results(execution_id,invocation_id,result) VALUES(?,?,?)', [call.executionId, call.invocationId, encode(result)])
    return result
  })
}

export async function controlPreparationAttempt(call: NodeCall): Promise<number> {
  const row = await db.get<{ attempt: number }>('SELECT attempt FROM node_runs WHERE execution_id=? AND invocation_id=? ORDER BY attempt DESC LIMIT 1', [call.executionId, call.invocationId])
  if (!row) throw new StoredExecutionDataError('控制节点调用记录不存在')
  return row.attempt
}

export async function appendEvent(executionId: number, key: string, type: string, nodeId: string, data?: unknown): Promise<void> {
  await db.transaction(async () => {
  if (type !== 'completed') {
    const row = await getExecutionRow(executionId)
    if (!row || row.status !== 'running' || row.completion_status !== null) return
  }
  await db.run('INSERT OR IGNORE INTO execution_events(execution_id,event_key,type,node_id,data) VALUES(?,?,?,?,?)',
    [executionId, key, type, nodeId, data === undefined ? null : encode(data)])
  })
}
export async function readExecutionEvents(id: number, after: number): Promise<StoredExecutionEvent[]> {
  const rows = await db.all<{ id: number; type: string; node_id: string; data: string | null }>(
    'SELECT id,type,node_id,data FROM execution_events WHERE execution_id=? AND id>? ORDER BY id LIMIT 20', [id, after])
  return rows.map(row => ({ id: row.id, type: row.type, nodeId: row.node_id, ...(row.data === null ? {} : { data: parse(row.data) }) }))
}
export async function saveExecutionCompletion(id: number, status: CompletionStatus, resultRef: string | null, error?: string): Promise<void> {
  if (resultRef !== null) await readValue(resultRef, id)
  await db.transaction(async () => {
    const execution = await getExecutionRow(id)
    if (!execution || execution.status !== 'running') return
    if (status !== 'success') {
      const running = await db.all<NodeRunRow>("SELECT * FROM node_runs WHERE execution_id=? AND status='running'", [id])
      for (const row of running) {
        await failNodeRun({ executionId: id, nodeId: row.node_id, invocationId: row.invocation_id, scopePath: row.scope_path, sequence: row.sequence, contextRef: null, locals: {} }, row.attempt, error || '所属工作流已结束', status)
      }
    }
    await db.run('UPDATE executions SET completion_status=?,result_ref=?,completion_error=? WHERE id=?', [status, resultRef, error ?? null, id])
  })
}
export async function settleExecution(id: number, status: CompletionStatus, resultRef: string | null, error?: string): Promise<void> {
  const result = resultRef !== null ? await readValue(resultRef, id) : error ? { error } : null
  await db.transaction(async () => {
    await db.run(`UPDATE executions SET status=?,result_ref=?,result=?,completion_status=?,completion_error=?,ended_at=COALESCE(ended_at,?) WHERE id=?`,
      [status, resultRef, encode(result), status, error ?? null, new Date().toISOString(), id])
    await appendEvent(id, 'completed', 'completed', '', { status, result, ...(error ? { error } : {}) })
  })
}
export async function interruptLegacyExecutions(): Promise<void> {
  await db.run(`UPDATE executions SET status='stopped',ended_at=?,result=? WHERE status='running' AND temporal_workflow_id IS NULL`,
    [new Date().toISOString(), encode({ error: '旧执行器任务已中断，请重新运行' })])
}

async function decodeNodeRun(row: NodeRunRow): Promise<NodeRun> {
  return { invocationId: row.invocation_id, nodeId: row.node_id, scopePath: row.scope_path, attempt: row.attempt, status: row.status,
    input: row.input_ref ? await readValue(row.input_ref, row.execution_id) : null,
    output: row.output_ref ? await readValue(row.output_ref, row.execution_id) : null,
    startedAt: row.started_at, ...(row.ended_at ? { endedAt: row.ended_at } : {}), ...(row.error ? { error: row.error } : {}) }
}
function stateFromRun(run: NodeRun): NodeExecutionState {
  return { input: run.input, output: run.output, status: run.status, startedAt: run.startedAt,
    ...(run.endedAt ? { endedAt: run.endedAt } : {}), ...(run.error ? { error: run.error } : {}) }
}
export async function readExecution(id: number): Promise<Execution | undefined> {
  return db.transaction(async () => {
  const row = await getExecutionRow(id)
  if (!row) return undefined
  const context: ExecutionContext = {}
  const oldContext = row.context ? parse(row.context) : {}
  if (isRecord(oldContext)) for (const [key, value] of Object.entries(oldContext)) if (isNodeState(value)) context[key] = value
  const oldLogs = row.logs ? parse(row.logs) : []
  const logs: ExecutionLog[] = Array.isArray(oldLogs) ? oldLogs.filter(isLog) : []
  const nodeRows = await db.all<NodeRunRow>('SELECT * FROM node_runs WHERE execution_id=? ORDER BY sequence,attempt,id', [id])
  const nodeRuns = await Promise.all(nodeRows.map(decodeNodeRun))
  for (const run of nodeRuns) context[run.nodeId] = stateFromRun(run)
  const logRows = await db.all<{ data: string }>("SELECT data FROM execution_events WHERE execution_id=? AND type='log' AND data IS NOT NULL ORDER BY id", [id])
  for (const event of logRows) {
    const log = parse(event.data)
    if (isLog(log)) logs.push(log)
  }
  const cursor = await db.get<{ id: number }>('SELECT COALESCE(MAX(id),0) AS id FROM execution_events WHERE execution_id=?', [id])
  const snapshot = row.workflow_snapshot ? parse(row.workflow_snapshot) : null
  return { id: row.id, workflow_id: row.workflow_id, status: row.status, context, logs,
    workflow_snapshot: isWorkflow(snapshot) ? snapshot : null,
    ...(row.variables_snapshot ? { input: parse(row.variables_snapshot) } : {}),
    ...(row.completion_error ? { error: row.completion_error } : {}),
    result: row.result ? parse(row.result) : null, nodeRuns,
    engine_version: row.engine_version, temporal_workflow_id: row.temporal_workflow_id, start_state: row.start_state, last_event_id: cursor?.id || 0,
    ...(row.started_at ? { started_at: row.started_at } : {}), ...(row.ended_at ? { ended_at: row.ended_at } : {}) }
  }, 'read')
}

export async function getNodeResult(executionId: number, invocationId: string): Promise<NodeTaskResult | undefined> {
  const row = await db.get<{ result: string }>('SELECT result FROM node_results WHERE execution_id=? AND invocation_id=?', [executionId, invocationId])
  return row ? decodeNodeResult(parse(row.result)) : undefined
}
async function emitNodeRun(call: NodeCall, attempt: number, phase: 'started' | 'success' | 'failed', message: string): Promise<void> {
  const row = await db.get<NodeRunRow>('SELECT * FROM node_runs WHERE execution_id=? AND invocation_id=? AND attempt=?', [call.executionId, call.invocationId, attempt])
  if (!row) throw new Error('节点调用记录不存在')
  const run = await decodeNodeRun(row)
  const prefix = `${call.invocationId}:${attempt}:${phase}`
  await appendEvent(call.executionId, `${prefix}:state`, 'state', call.nodeId, stateFromRun(run))
  await appendEvent(call.executionId, `${prefix}:run`, 'nodeRun', call.nodeId, run)
  await appendEvent(call.executionId, `${prefix}:log`, 'log', call.nodeId,
    { time: new Date().toISOString(), nodeId: call.nodeId, level: phase === 'failed' ? 'error' : 'info', message })
}
export async function prepareNodeRun(call: NodeCall, attempt: number, input: unknown): Promise<void> {
  await db.transaction(async () => {
    const current = await assertCurrentAttempt(call, attempt)
    if (current && current.status !== 'running') throw new StoredExecutionDataError('节点尝试已经结束，不能重新准备')
    // Worker 强杀或 Activity 超时没有机会回写，下一次尝试负责封存前次调用。
    const interrupted = await db.all<{ attempt: number }>("SELECT attempt FROM node_runs WHERE execution_id=? AND invocation_id=? AND attempt<? AND status='running'", [call.executionId, call.invocationId, attempt])
    for (const previous of interrupted) await failNodeRun(call, previous.attempt, '节点尝试因执行器中断或超时而结束')
    const inputRef = await writeValue(call.executionId, input)
    await db.run(`INSERT OR IGNORE INTO node_runs(execution_id,invocation_id,node_id,scope_path,sequence,attempt,status,input_ref,started_at)
      VALUES(?,?,?,?,?,?,'running',?,?)`, [call.executionId, call.invocationId, call.nodeId, call.scopePath, call.sequence, attempt, inputRef, new Date().toISOString()])
    await emitNodeRun(call, attempt, 'started', '开始执行节点')
  })
}
export async function recordCachedNodeAttempt(call: NodeCall, attempt: number): Promise<void> {
  await db.transaction(async () => {
  const current = await assertCurrentAttempt(call, attempt)
  if (current && current.status !== 'running' && current.status !== 'success') throw new StoredExecutionDataError('节点尝试已经失败或取消，不能改写为成功')
  const interrupted = await db.all<{ attempt: number }>("SELECT attempt FROM node_runs WHERE execution_id=? AND invocation_id=? AND attempt<? AND status='running'", [call.executionId, call.invocationId, attempt])
  for (const previous of interrupted) await failNodeRun(call, previous.attempt, '节点尝试因执行器中断或超时而结束')
  await db.run(`INSERT INTO node_runs(execution_id,invocation_id,node_id,scope_path,sequence,attempt,status,input_ref,output_ref,started_at,ended_at)
    SELECT execution_id,invocation_id,node_id,scope_path,sequence,?,'success',input_ref,output_ref,?,? FROM node_runs
    WHERE execution_id=? AND invocation_id=? AND status='success' ORDER BY attempt LIMIT 1
    ON CONFLICT(execution_id,invocation_id,attempt) DO UPDATE SET status='success',output_ref=excluded.output_ref,ended_at=excluded.ended_at,error=NULL WHERE node_runs.status='running'`,
  [attempt, new Date().toISOString(), new Date().toISOString(), call.executionId, call.invocationId])
  await emitNodeRun(call, attempt, 'success', '复用已保存的节点结果')
  })
}
export async function completeNodeRun(call: NodeCall, attempt: number, output: unknown, refs: Record<string, string>, extra: { route?: string; items?: string[] } = {}): Promise<NodeTaskResult> {
  return db.transaction(async () => {
    const current = await assertCurrentAttempt(call, attempt)
    const cached = await getNodeResult(call.executionId, call.invocationId)
    if (!current || current.status !== 'running' && !(current.status === 'success' && cached?.outputRef)) throw new StoredExecutionDataError('节点尝试已结束或不存在，不能提交结果')
    if (cached?.outputRef) {
      if (current.status === 'running') await recordCachedNodeAttempt(call, attempt)
      return cached
    }
    const outputRef = await writeValue(call.executionId, output)
    const contextRef = await writeContextReferences(call.executionId, { ...refs, [call.nodeId]: outputRef })
    const result: NodeTaskResult = { outputRef, contextRef, ...extra }
    await db.run('INSERT INTO node_results(execution_id,invocation_id,result) VALUES(?,?,?) ON CONFLICT(execution_id,invocation_id) DO UPDATE SET result=excluded.result', [call.executionId, call.invocationId, encode(result)])
    await db.run("UPDATE node_runs SET status='success',output_ref=?,ended_at=?,error=NULL WHERE execution_id=? AND invocation_id=? AND attempt=?",
      [outputRef, new Date().toISOString(), call.executionId, call.invocationId, attempt])
    await emitNodeRun(call, attempt, 'success', '节点执行完成')
    return result
  })
}
export async function failNodeRun(call: NodeCall, attempt: number, error: string, status: 'failed' | 'stopped' = 'failed'): Promise<void> {
  await db.transaction(async () => {
    const execution = await getExecutionRow(call.executionId)
    const run = await db.get<NodeRunRow>('SELECT * FROM node_runs WHERE execution_id=? AND invocation_id=? AND attempt=?', [call.executionId, call.invocationId, attempt])
    if (!execution || execution.status !== 'running' || execution.completion_status !== null || run?.status !== 'running') return
    await db.run("UPDATE node_runs SET status=?,error=?,ended_at=? WHERE execution_id=? AND invocation_id=? AND attempt=? AND status='running'",
      [status, error, new Date().toISOString(), call.executionId, call.invocationId, attempt])
    await emitNodeRun(call, attempt, 'failed', error)
  })
}

export async function failControlRun(call: NodeCall, status: 'failed' | 'stopped', error: string): Promise<void> {
  await db.transaction(async () => {
    const rows = await db.all<{ attempt: number }>("SELECT attempt FROM node_runs WHERE execution_id=? AND invocation_id=? AND status='running'", [call.executionId, call.invocationId])
    for (const row of rows) await failNodeRun(call, row.attempt, error, status)
  })
}
