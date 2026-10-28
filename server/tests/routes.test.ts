import { describe, it, expect, beforeAll } from 'vitest'
import supertest from 'supertest'
import http from 'http'

process.env.DB_PATH = ':memory:'

const { initializeDb } = await import('../src/db/index.js')
const { createApp } = await import('../src/app.js')

let app: ReturnType<typeof createApp>

beforeAll(async () => {
  await initializeDb()
  app = createApp()
})

async function waitForExecution(id: number): Promise<Record<string, any>> {
  for (let i = 0; i < 50; i++) {
    const res = await supertest(app).get(`/api/executions/${id}`).expect(200)
    if (res.body.status !== 'running') {
      return res.body
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Execution ${id} did not finish in time`)
}

describe('REST routes', () => {
  describe('GET /api/apis', () => {
    it('returns an empty list initially', async () => {
      const res = await supertest(app).get('/api/apis').expect(200)
      expect(res.body).toEqual([])
    })
  })

  describe('POST /api/apis', () => {
    it('creates an API and returns its id', async () => {
      const res = await supertest(app)
        .post('/api/apis')
        .send({ name: '加法服务', method: 'POST', url: 'https://httpbin.org/post' })
        .expect(201)

      expect(res.body).toHaveProperty('id')
      expect(typeof res.body.id).toBe('number')

      const list = await supertest(app).get('/api/apis').expect(200)
      expect(list.body).toHaveLength(1)
      expect(list.body[0].name).toBe('加法服务')
    })

    it('returns 400 when required fields are missing', async () => {
      const res = await supertest(app)
        .post('/api/apis')
        .send({ name: 'test' })
        .expect(400)

      expect(res.body).toMatchObject({ status: 400, message: expect.stringContaining('method') })
    })
  })

  describe('GET /api/workflows/:id', () => {
    it('returns 404 for a non-existent id', async () => {
      const res = await supertest(app).get('/api/workflows/999').expect(404)
      expect(res.body).toMatchObject({ status: 404, message: expect.stringContaining('not found') })
    })

    it('returns 400 for an invalid id', async () => {
      const res = await supertest(app).get('/api/workflows/abc').expect(400)
      expect(res.body).toMatchObject({ status: 400, message: expect.stringContaining('Invalid id') })
    })
  })

  describe('POST /api/workflows', () => {
    it('creates a workflow and returns its id', async () => {
      const workflow = {
        name: 'test workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const res = await supertest(app)
        .post('/api/workflows')
        .send(workflow)
        .expect(201)

      expect(res.body).toHaveProperty('id')
      expect(typeof res.body.id).toBe('number')

      const detail = await supertest(app).get(`/api/workflows/${res.body.id}`).expect(200)
      expect(detail.body.name).toBe('test workflow')
      expect(detail.body.nodes).toHaveLength(2)
    })

    it('returns 400 when required fields are missing', async () => {
      const res = await supertest(app)
        .post('/api/workflows')
        .send({ name: 'test' })
        .expect(400)

      expect(res.body).toMatchObject({ status: 400, message: expect.stringContaining('nodes') })
    })
  })

  describe('PUT /api/apis/:id', () => {
    it('returns 404 when updating a non-existent record', async () => {
      const res = await supertest(app)
        .put('/api/apis/999')
        .send({ name: 'missing', method: 'GET', url: 'https://example.com' })
        .expect(404)

      expect(res.body).toMatchObject({ status: 404 })
    })
  })

  describe('DELETE /api/apis/:id', () => {
    it('returns 404 when deleting a non-existent record', async () => {
      const res = await supertest(app).delete('/api/apis/999').expect(404)
      expect(res.body).toMatchObject({ status: 404 })
    })
  })

  describe('POST /api/workflows/:id/execute', () => {
    it('returns executionId immediately and finishes asynchronously', async () => {
      const workflow = {
        name: 'executable workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { inputMapping: { value: 'var.x' } } },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      const res = await supertest(app)
        .post(`/api/workflows/${created.body.id}/execute`)
        .send({ variables: { x: 42 } })
        .expect(200)

      expect(res.body).toHaveProperty('executionId')
      expect(typeof res.body.executionId).toBe('number')
      expect(res.body).not.toHaveProperty('status')

      const execution = await waitForExecution(res.body.executionId)
      expect(execution.status).toBe('success')
      expect(execution.context.start.output.value).toBe(42)
    })
  })

  describe('POST /api/workflows/:id/publish', () => {
    it('publishes a workflow with a URL-safe path', async () => {
      const workflow = {
        name: 'publishable workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      const res = await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: 'my-workflow_1' })
        .expect(200)

      expect(res.body.is_published).toBe(true)
      expect(res.body.publish_path).toBe('my-workflow_1')
    })

    it('rejects an empty or non-URL-safe publish path', async () => {
      const workflow = {
        name: 'unpublishable workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      const empty = await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: '  ' })
        .expect(400)
      expect(empty.body.message).toContain('publish_path')

      const unsafe = await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: 'a/b' })
        .expect(400)
      expect(unsafe.body.message).toContain('URL-safe')
    })

    it('returns 409 when another workflow already uses the publish path', async () => {
      const base = {
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const first = await supertest(app).post('/api/workflows').send({ name: 'first', ...base }).expect(201)
      await supertest(app)
        .post(`/api/workflows/${first.body.id}/publish`)
        .send({ publish_path: 'shared-path' })
        .expect(200)

      const second = await supertest(app).post('/api/workflows').send({ name: 'second', ...base }).expect(201)
      const res = await supertest(app)
        .post(`/api/workflows/${second.body.id}/publish`)
        .send({ publish_path: 'shared-path' })
        .expect(409)

      expect(res.body.message).toContain('already in use')
    })

    it('allows republishing the same workflow with the same path', async () => {
      const workflow = {
        name: 'republishable workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: 'same-path' })
        .expect(200)

      const res = await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: 'same-path' })
        .expect(200)

      expect(res.body.is_published).toBe(true)
      expect(res.body.publish_path).toBe('same-path')
    })
  })

  describe('POST /api/workflows/:id/unpublish', () => {
    it('unpublishes a workflow and clears the publish path', async () => {
      const workflow = {
        name: 'to unpublish',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: 'temp-path' })
        .expect(200)

      const res = await supertest(app)
        .post(`/api/workflows/${created.body.id}/unpublish`)
        .expect(200)

      expect(res.body.is_published).toBe(false)
      expect(res.body.publish_path).toBeNull()
    })
  })

  describe('POST /api/run/:publish_path', () => {
    it('executes a published workflow with the provided variables', async () => {
      const workflow = {
        name: 'public workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { inputMapping: { value: 'var.x' } } },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: 'public-run' })
        .expect(200)

      const res = await supertest(app)
        .post('/api/run/public-run')
        .send({ x: 42 })
        .expect(200)

      expect(res.body).toHaveProperty('executionId')
      expect(typeof res.body.executionId).toBe('number')
      expect(res.body).not.toHaveProperty('status')

      const execution = await waitForExecution(res.body.executionId)
      expect(execution.status).toBe('success')
      expect(execution.context.start.output.value).toBe(42)
    })

    it('returns 404 for an unpublished workflow', async () => {
      const workflow = {
        name: 'private workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      await supertest(app)
        .post(`/api/workflows/${created.body.id}/publish`)
        .send({ publish_path: 'then-unpublish' })
        .expect(200)
      await supertest(app)
        .post(`/api/workflows/${created.body.id}/unpublish`)
        .expect(200)

      const res = await supertest(app)
        .post('/api/run/then-unpublish')
        .send({})
        .expect(404)
      expect(res.body.message).toContain('not found')
    })
  })

  describe('GET /api/executions/:id/events', () => {
    it('streams execution events via SSE', async () => {
      const workflow = {
        name: 'sse workflow',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { inputMapping: { value: 'var.x' } } },
          {
            id: 'slow',
            type: 'python',
            position: { x: 100, y: 0 },
            data: {
              inputMapping: { value: 'var.x' },
              code: 'import time; time.sleep(0.3); OUTPUT = value',
              outputMapping: { result: 'OUTPUT' },
              outputVar: 'OUTPUT'
            }
          },
          { id: 'end', type: 'end', position: { x: 200, y: 0 }, data: { resultExpression: 'ctx.slow.output.result' } }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'slow' },
          { id: 'e2', source: 'slow', target: 'end' }
        ]
      }

      const created = await supertest(app).post('/api/workflows').send(workflow).expect(201)
      const executed = await supertest(app)
        .post(`/api/workflows/${created.body.id}/execute`)
        .send({ variables: { x: 42 } })
        .expect(200)

      const executionId = executed.body.executionId
      const server = app.listen(0)
      const { port } = server.address() as { port: number }

      const events: string[] = []
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/executions/${executionId}/events`, (res) => {
          res.on('data', (chunk: Buffer) => {
            events.push(chunk.toString())
            const text = events.join('')
            if (text.includes('"type":"state"') && text.includes('"type":"log"')) {
              req.destroy()
              server.close()
              resolve()
            }
          })
          res.on('end', () => {
            server.close()
            resolve()
          })
          res.on('error', (err) => {
            server.close()
            reject(err)
          })
        })
        req.on('error', () => {
          server.close()
          resolve()
        })
        setTimeout(() => {
          req.destroy()
          server.close()
          resolve()
        }, 3000)
      })

      const text = events.join('')
      expect(text).toContain('"type":"connected"')
      expect(text).toContain('"type":"state"')
      expect(text).toContain('"type":"log"')

      const execution = await waitForExecution(executionId)
      expect(execution.status).toBe('success')
      expect(execution.result).toBe(42)
    }, 30000)
  })
})
