import { Router } from 'express'
import { db, getWorkflow } from '../db/index.js'
import { executeWorkflow } from '../services/executor.js'
import { Workflow } from '../types/index.js'

const router = Router()

router.get('/', async (_req, res) => {
  res.json(await db.prepare('SELECT id, name, description, is_published, publish_path, updated_at FROM workflows ORDER BY id DESC').all())
})

router.get('/:id', async (req, res) => {
  const row = await getWorkflow(Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json({
    ...row,
    variables: row.variables ? JSON.parse(row.variables) : [],
    nodes: JSON.parse(row.nodes),
    edges: JSON.parse(row.edges),
    is_published: Boolean(row.is_published)
  })
})

router.post('/', async (req, res) => {
  const wf: Workflow = req.body
  const info = await db.prepare(`
    INSERT INTO workflows (name, description, variables, nodes, edges)
    VALUES (?, ?, ?, ?, ?)
  `).run([wf.name, wf.description || null, JSON.stringify(wf.variables || []), JSON.stringify(wf.nodes), JSON.stringify(wf.edges)])
  res.json({ id: info.lastID })
})

router.put('/:id', async (req, res) => {
  const wf: Workflow = req.body
  await db.prepare(`
    UPDATE workflows
    SET name=?, description=?, variables=?, nodes=?, edges=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run([wf.name, wf.description || null, JSON.stringify(wf.variables || []), JSON.stringify(wf.nodes), JSON.stringify(wf.edges), req.params.id])
  res.json({ updated: true })
})

router.post('/:id/execute', async (req, res) => {
  const row = await getWorkflow(Number(req.params.id))
  if (!row) return res.status(404).json({ error: 'Not found' })
  const workflow: Workflow = {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    variables: row.variables ? JSON.parse(row.variables) : [],
    nodes: JSON.parse(row.nodes),
    edges: JSON.parse(row.edges)
  }
  const variables = req.body.variables || {}
  const execution = await executeWorkflow(workflow, variables)
  const info = await db.prepare(`
    INSERT INTO executions (workflow_id, status, context, logs, result, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run([
    execution.workflow_id,
    execution.status,
    JSON.stringify(execution.context),
    JSON.stringify(execution.logs),
    JSON.stringify(execution.result),
    execution.started_at || new Date().toISOString(),
    execution.ended_at
  ])
  res.json({ executionId: info.lastID, ...execution })
})

export default router
