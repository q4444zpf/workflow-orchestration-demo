import { Router } from 'express'
import { db } from '../db/index.js'
import { RegisteredApi } from '../types/index.js'

const router = Router()

router.get('/', async (_req, res) => {
  const rows = await db.prepare('SELECT * FROM registered_apis ORDER BY id DESC').all()
  res.json(rows.map((r: any) => ({
    ...r,
    headers: r.headers ? JSON.parse(r.headers) : {},
    sample_params: r.sample_params ? JSON.parse(r.sample_params) : null,
    output_schema: r.output_schema ? JSON.parse(r.output_schema) : null
  })))
})

router.post('/', async (req, res) => {
  const api: RegisteredApi = req.body
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
  res.json({ id: info.lastID })
})

router.put('/:id', async (req, res) => {
  const api: RegisteredApi = req.body
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
    req.params.id
  ])
  res.json({ updated: true })
})

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM registered_apis WHERE id=?').run(req.params.id)
  res.json({ deleted: true })
})

export default router
