import { describe, it, expect, beforeAll } from 'vitest'
import supertest from 'supertest'

process.env.DB_PATH = ':memory:'

const { initializeDb } = await import('../src/db/index.js')
const { createApp } = await import('../src/app.js')

let app: ReturnType<typeof createApp>

beforeAll(async () => {
  await initializeDb()
  app = createApp()
})

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
})
