import { db } from '../db/index.js'
import { HttpError } from '../middleware/errorHandler.js'

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new HttpError(400, '分页和工作流编号必须是正整数')
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number > maximum) throw new HttpError(400, '查询参数超出允许范围')
  return number
}

/** 列表只读概要，不加载执行值、日志或完整工作流定义。 */
export async function listExecutionHistory(query: Record<string, unknown>) {
  const page = positiveInteger(query.page, 1, 1_000_000)
  const pageSize = positiveInteger(query.pageSize, 20, 100)
  const workflowId = query.workflowId === undefined ? undefined : positiveInteger(query.workflowId, 1, Number.MAX_SAFE_INTEGER)
  const status = query.status
  if (status !== undefined && (typeof status !== 'string' || !['running', 'success', 'failed', 'stopped'].includes(status))) throw new HttpError(400, '未知的执行状态')
  const clauses: string[] = []
  const params: (string | number)[] = []
  if (workflowId !== undefined) { clauses.push('e.workflow_id=?'); params.push(workflowId) }
  if (typeof status === 'string') { clauses.push('e.status=?'); params.push(status) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return db.transaction(async () => {
    const count = await db.get<{ total: number }>(`SELECT COUNT(*) AS total FROM executions e ${where}`, params)
    const items = await db.all<{
      id: number; workflow_id: number; workflow_name: string | null; status: string
      started_at: string | null; ended_at: string | null; start_state: string | null
    }>(`SELECT e.id,e.workflow_id,e.status,e.started_at,e.ended_at,e.start_state,
      COALESCE(CASE WHEN json_valid(e.workflow_snapshot) THEN json_extract(e.workflow_snapshot,'$.name') END,w.name) AS workflow_name
      FROM executions e LEFT JOIN workflows w ON w.id=e.workflow_id ${where} ORDER BY e.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize])
    return { items, total: count?.total || 0, page, pageSize }
  }, 'read')
}
