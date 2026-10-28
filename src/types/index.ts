import type { Node } from '@vue-flow/core'

export interface Position {
  x: number
  y: number
}

export interface FlowNode {
  id: string
  type: string
  position: Position
  data: Record<string, any>
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  label?: string
}

export interface WorkflowVariable {
  name: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  default?: any
  description?: string
}

export interface Workflow {
  id?: number
  name: string
  description?: string
  variables?: WorkflowVariable[]
  nodes: FlowNode[]
  edges: FlowEdge[]
  publish_path?: string
  is_published?: boolean
  auth_type?: 'none' | 'token'
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface RegisteredApi {
  id?: number
  name: string
  description?: string
  method: HttpMethod
  url: string
  headers?: Record<string, string>
  sample_params?: any
  output_schema?: any
}

export interface ExecutionLog {
  time: string
  nodeId: string
  level: 'info' | 'error' | 'debug'
  message: string
}

export interface NodeExecutionState {
  input: any
  output: any
  status: 'pending' | 'running' | 'success' | 'failed'
  startedAt?: string
  endedAt?: string
  error?: string
}

export interface ExecutionContext {
  [nodeId: string]: NodeExecutionState
}

export interface Execution {
  id?: number
  workflow_id: number
  status: 'running' | 'success' | 'failed' | 'stopped'
  context: ExecutionContext
  logs: ExecutionLog[]
  result: any
  started_at?: string
  ended_at?: string
}

export type TypedNode = Node & { type: string; data: Record<string, any> }
