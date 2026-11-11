import { Router } from 'express'
import { db, getWorkflow } from '../db/index.js'
import { startWorkflowExecution } from '../services/executionService.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { HttpError } from '../middleware/errorHandler.js'
import { validateId, validateWorkflow } from '../middleware/validation.js'
import { assertValidWorkflowGraph } from '../services/workflowValidator.js'

const router = Router()
const runRouter = Router()

function requestKey(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(value)) throw new HttpError(400, '请求标识必须为不超过 128 个字符的字母、数字或安全分隔符')
  return value
}

function validatePublishPath(path: unknown): string {
  if (!path || typeof path !== 'string' || path.trim().length === 0) {
    throw new HttpError(400, 'Field "publish_path" is required and must be a non-empty string')
  }
  const trimmed = path.trim()
  if (!/^[a-zA-Z0-9_.~_-]+$/.test(trimmed)) {
    throw new HttpError(400, 'Field "publish_path" must be URL-safe (alphanumeric, -, _, ., ~)')
  }
  return trimmed
}

function toWorkflowSummary(row: Awaited<ReturnType<typeof getWorkflow>>) {
  if (!row) throw new HttpError(404, 'Workflow not found')
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    is_published: Boolean(row.is_published),
    publish_path: row.publish_path,
    updated_at: row.updated_at
  }
}

router.get('/', asyncHandler(async (_req, res) => {
  res.json(await db.prepare('SELECT id, name, description, is_published, publish_path, updated_at FROM workflows ORDER BY id DESC').all())
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const id = validateId(req.params.id)
  const row = await getWorkflow(id)
  if (!row) throw new HttpError(404, 'Workflow not found')
  res.json({
    ...row,
    variables: row.variables ? JSON.parse(row.variables) : [],
    nodes: JSON.parse(row.nodes),
    edges: JSON.parse(row.edges),
    is_published: Boolean(row.is_published)
  })
}))

router.post('/', asyncHandler(async (req, res) => {
  const wf = validateWorkflow(req.body)
  const info = await db.prepare(`
    INSERT INTO workflows (name, description, variables, nodes, edges, schema_version)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run([wf.name, wf.description || null, JSON.stringify(wf.variables || []), JSON.stringify(wf.nodes), JSON.stringify(wf.edges), wf.schema_version])
  res.status(201).json({ id: info.lastID })
}))

router.put('/:id', asyncHandler(async (req, res) => {
  const id = validateId(req.params.id)
  const wf = validateWorkflow(req.body)
  const existing = await getWorkflow(id)
  if (!existing) throw new HttpError(404, 'Workflow not found')
  await db.prepare(`
    UPDATE workflows
    SET name=?, description=?, variables=?, nodes=?, edges=?, schema_version=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run([wf.name, wf.description || null, JSON.stringify(wf.variables || []), JSON.stringify(wf.nodes), JSON.stringify(wf.edges), wf.schema_version, id])
  res.json({ updated: true })
}))

router.post('/:id/execute', asyncHandler(async (req, res) => {
  const id = validateId(req.params.id)
  const row = await getWorkflow(id)
  if (!row) throw new HttpError(404, 'Workflow not found')
  const variables = req.body?.variables === undefined ? {} : req.body.variables
  const executionId = await persistAndExecuteWorkflow(row, variables, requestKey(req.get('Idempotency-Key') || req.body?.requestId))
  res.json({ executionId })
}))

router.post('/:id/publish', asyncHandler(async (req, res) => {
  const id = validateId(req.params.id)
  const existing = await getWorkflow(id)
  if (!existing) throw new HttpError(404, 'Workflow not found')
  const publishPath = validatePublishPath(req.body.publish_path)
  assertValidWorkflowGraph({ nodes: JSON.parse(existing.nodes), edges: JSON.parse(existing.edges) })
  const conflict = await db.prepare('SELECT id FROM workflows WHERE publish_path=? AND is_published=1 AND id != ?')
    .get<{ id: number }>([publishPath, id])
  if (conflict) throw new HttpError(409, 'Publish path already in use')
  await db.prepare('UPDATE workflows SET is_published=1, publish_path=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run([publishPath, id])
  const row = await getWorkflow(id)
  res.json(toWorkflowSummary(row))
}))

router.post('/:id/unpublish', asyncHandler(async (req, res) => {
  const id = validateId(req.params.id)
  const existing = await getWorkflow(id)
  if (!existing) throw new HttpError(404, 'Workflow not found')
  await db.prepare('UPDATE workflows SET is_published=0, publish_path=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run([id])
  const row = await getWorkflow(id)
  res.json(toWorkflowSummary(row))
}))

async function persistAndExecuteWorkflow(row: NonNullable<Awaited<ReturnType<typeof getWorkflow>>>, inputs: unknown, requestKey?: string) {
  const workflow = validateWorkflow({
    schema_version: row.schema_version,
    name: row.name, description: row.description || undefined,
    variables: row.variables ? JSON.parse(row.variables) : [],
    nodes: JSON.parse(row.nodes), edges: JSON.parse(row.edges)
  })
  return startWorkflowExecution({ ...workflow, id: row.id }, inputs, requestKey)
}

runRouter.post('/:publish_path', asyncHandler(async (req, res) => {
  const publishPath = validatePublishPath(req.params.publish_path)
  const row = await db.prepare('SELECT * FROM workflows WHERE publish_path=? AND is_published=1')
    .get<NonNullable<Awaited<ReturnType<typeof getWorkflow>>>>(publishPath)
  if (!row) throw new HttpError(404, 'Published workflow not found')
  const variables = req.body || {}
  const executionId = await persistAndExecuteWorkflow(row, variables, requestKey(req.get('Idempotency-Key')))
  res.json({ executionId })
}))

export default router
export { runRouter }
