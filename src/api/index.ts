import axios from 'axios'
import type { RegisteredApi, Workflow, WorkflowSummary, Execution, ExecutionPage, ExecutionQuery } from '../types/index.js'

const client = axios.create({ baseURL: '/api' })

export const apiApi = {
  list: () => client.get('/apis').then((r) => r.data as RegisteredApi[]),
  create: (api: RegisteredApi) => client.post('/apis', api),
  update: (id: number, api: RegisteredApi) => client.put(`/apis/${id}`, api),
  remove: (id: number) => client.delete(`/apis/${id}`)
}

export const workflowApi = {
  list: () => client.get<WorkflowSummary[]>('/workflows').then((r) => r.data),
  get: (id: number) => client.get(`/workflows/${id}`).then((r) => r.data as Workflow),
  create: (wf: Workflow) => client.post('/workflows', wf),
  update: (id: number, wf: Workflow) => client.put(`/workflows/${id}`, wf),
  execute: (id: number, variables: Record<string, any>, requestId?: string) => client.post(`/workflows/${id}/execute`, { variables, requestId }, requestId ? { headers: { 'Idempotency-Key': requestId } } : undefined).then((r) => r.data),
  publish: (id: number, publishPath: string) => client.post(`/workflows/${id}/publish`, { publish_path: publishPath }).then((r) => r.data as Workflow),
  unpublish: (id: number) => client.post(`/workflows/${id}/unpublish`).then((r) => r.data as Workflow)
}

export const runApi = {
  execute: (publishPath: string, variables: Record<string, any>) => client.post(`/run/${publishPath}`, variables).then((r) => r.data)
}

export const executionApi = {
  list: (params: ExecutionQuery) => client.get<ExecutionPage>('/executions', { params }).then((r) => r.data),
  get: (id: number) => client.get<Execution>(`/executions/${id}`).then((r) => r.data),
  events: (id: number, lastEventId?: string) => new EventSource(`/api/executions/${id}/events${lastEventId ? `?after=${encodeURIComponent(lastEventId)}` : ''}`)
}
