import { Router } from 'express'
import { db } from '../db/index.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { HttpError } from '../middleware/errorHandler.js'
import { validateId, validateRegisteredApi } from '../middleware/validation.js'

const router = Router()

router.get('/', asyncHandler(async (_req, res) => {
  const rows = await db.prepare('SELECT * FROM registered_apis ORDER BY id DESC').all()
  res.json(rows.map((r: any) => ({
    ...r,
    headers: r.headers ? JSON.parse(r.headers) : {},
    sample_params: r.sample_params ? JSON.parse(r.sample_params) : null,
    output_schema: r.output_schema ? JSON.parse(r.output_schema) : null
  })))
}))

router.post('/', asyncHandler(async (req, res) => {
  const api = validateRegisteredApi(req.body)
  const info = await db.prepare(`
    INSERT INTO registered_apis (name, description, method, url, headers, sample_params, output_schema)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run([
    api.name,
    api.description || null,
    api.method,
    api.url,
    JSON.stringify(api.headers || {}),
    JSON.stringify(api.sample_params || null),
    JSON.stringify(api.output_schema || null)
  ])
  res.status(201).json({ id: info.lastID })
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const id = validateId(req.params.id)
  const row = await db.prepare('SELECT * FROM registered_apis WHERE id = ?').get(id) as any
  if (!row) throw new HttpError(404, 'API not found')
  res.json({
    ...row,
    headers: row.headers ? JSON.parse(row.headers) : {},
    sample_params: row.sample_params ? JSON.parse(row.sample_params) : null,
    output_schema: row.output_schema ? JSON.parse(row.output_schema) : null
  })
}))

router.put('/:id', asyncHandler(async (req, res) => {
  const id = validateId(req.params.id)
  const api = validateRegisteredApi(req.body)
  const existing = await db.prepare('SELECT id FROM registered_apis WHERE id = ?').get(id)
  if (!existing) throw new HttpError(404, 'API not found')
  await db.prepare(`
    UPDATE registered_apis
    SET name=?, description=?, method=?, url=?, headers=?, sample_params=?, output_schema=?
    WHERE id=?
  `).run([
    api.name,
    api.description || null,
    api.method,
    api.url,
    JSON.stringify(api.headers || {}),
    JSON.stringify(api.sample_params || null),
    JSON.stringify(api.output_schema || null),
    id
  ])
  res.json({ updated: true })
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = validateId(req.params.id)
  const existing = await db.prepare('SELECT id FROM registered_apis WHERE id = ?').get(id)
  if (!existing) throw new HttpError(404, 'API not found')
  await db.prepare('DELETE FROM registered_apis WHERE id=?').run(id)
  res.json({ deleted: true })
}))

export default router
