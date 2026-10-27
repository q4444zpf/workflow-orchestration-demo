import { Router } from 'express'
import { db } from '../db/index.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { HttpError } from '../middleware/errorHandler.js'
import { validateId } from '../middleware/validation.js'

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
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  res.write('data: {"type":"connected"}\n\n')

  req.on('close', () => {
    res.end()
  })
})

export default router
