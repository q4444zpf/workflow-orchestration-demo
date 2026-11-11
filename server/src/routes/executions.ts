import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { HttpError } from '../middleware/errorHandler.js'
import { validateId } from '../middleware/validation.js'
import { registerExecutionConnection } from '../services/executionEvents.js'
import { readExecution } from '../services/executionStore.js'
import { synchronizeExecution } from '../services/executionService.js'
import { listExecutionHistory } from '../services/executionHistory.js'

const router = Router()

router.get('/', asyncHandler(async (req, res) => {
  res.json(await listExecutionHistory(req.query))
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const id = validateId(req.params.id)
  let warning: string | undefined
  try { await synchronizeExecution(id) }
  catch { warning = 'Temporal 暂时不可用，当前显示已保存的执行记录，状态待确认。' }
  const execution = await readExecution(id)
  if (!execution) throw new HttpError(404, 'Execution not found')
  res.json({ ...execution, ...(warning ? { sync_warning: warning } : {}) })
}))

router.get('/:id/events', asyncHandler(async (req, res) => {
  const id = validateId(req.params.id)
  const execution = await readExecution(id)
  if (!execution) throw new HttpError(404, 'Execution not found')
  const raw = req.get('Last-Event-ID') || req.query.after || '0'
  const after = Number(raw)
  if (!Number.isSafeInteger(after) || after < 0) throw new HttpError(400, '事件续传位置必须是非负整数')
  if (!execution.temporal_workflow_id) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.write(`data: ${JSON.stringify({ type: 'connected', nodeId: '' })}\n\n`)
    for (const [nodeId, data] of Object.entries(execution.context)) res.write(`data: ${JSON.stringify({ type: 'state', nodeId, data })}\n\n`)
    for (const data of execution.logs) res.write(`data: ${JSON.stringify({ type: 'log', nodeId: data.nodeId, data })}\n\n`)
    res.end(`data: ${JSON.stringify({ type: 'completed', nodeId: '' })}\n\n`)
    return
  }
  registerExecutionConnection(id, res, after)
}))

export default router
