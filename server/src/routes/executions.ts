import { Router } from 'express'
import { db } from '../db/index.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { HttpError } from '../middleware/errorHandler.js'
import { validateId } from '../middleware/validation.js'
import { registerExecutionConnection } from '../services/executionEvents.js'

const router = Router()

router.get('/:id', asyncHandler(async (req, res) => {
  const id = validateId(req.params.id)
  const row = await db.prepare('SELECT * FROM executions WHERE id=?').get(id) as any
  if (!row) throw new HttpError(404, 'Execution not found')
  res.json({
    ...row,
    context: JSON.parse(row.context),
    logs: JSON.parse(row.logs),
    result: JSON.parse(row.result)
  })
}))

router.get('/:id/events', (req, res) => {
  const id = validateId(req.params.id)
  registerExecutionConnection(id, res)
})

export default router
