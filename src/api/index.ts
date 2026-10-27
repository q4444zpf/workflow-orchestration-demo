import axios from 'axios'
import type { RegisteredApi, Workflow } from '../types/index.js'

const client = axios.create({ baseURL: '/api' })

export const apiApi = {
  list: () => client.get('/apis').then((r) => r.data as RegisteredApi[]),
  create: (api: RegisteredApi) => client.post('/apis', api),
  update: (id: number, api: RegisteredApi) => client.put(`/apis/${id}`, api),
  remove: (id: number) => client.delete(`/apis/${id}`)
}

export const workflowApi = {
  list: () => client.get('/workflows').then((r) => r.data),
  get: (id: number) => client.get(`/workflows/${id}`).then((r) => r.data as Workflow),
  create: (wf: Workflow) => client.post('/workflows', wf),
  update: (id: number, wf: Workflow) => client.put(`/workflows/${id}`, wf),
  execute: (id: number, variables: Record<string, any>) => client.post(`/workflows/${id}/execute`, { variables }).then((r) => r.data)
}

export const executionApi = {
  get: (id: number) => client.get(`/executions/${id}`).then((r) => r.data),
  events: (id: number) => new EventSource(`/api/executions/${id}/events`)
}
