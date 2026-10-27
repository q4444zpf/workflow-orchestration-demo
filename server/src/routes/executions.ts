import { Router } from 'express'
import { db } from '../db/index.js'

const router = Router()

router.get('/:id', async (req, res) => {
  const row = await db.prepare('SELECT * FROM executions WHERE id=?').get(req.params.id) as any
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json({
    ...row,
    context: JSON.parse(row.context),
    logs: JSON.parse(row.logs),
    result: JSON.parse(row.result)
  })
})

router.get('/:id/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  // 简单实现：直接结束，后续执行引擎增强后推送真实事件
  res.write('data: {"type":"connected"}\n\n')

  req.on('close', () => {
    res.end()
  })
})

export default router
