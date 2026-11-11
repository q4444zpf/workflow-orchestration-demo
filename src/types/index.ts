import type { Node } from '@vue-flow/core'
import type { WorkflowVariable } from '../../server/src/shared/parameterSchema'
export type { WorkflowVariable } from '../../server/src/shared/parameterSchema'

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
  branchId?: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface Workflow {
  schema_version?: number
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
  status: 'pending' | 'running' | 'success' | 'failed' | 'stopped'
  startedAt?: string
  endedAt?: string
  error?: string
}

export interface ExecutionContext {
  [nodeId: string]: NodeExecutionState
}

export interface NodeRun extends NodeExecutionState {
  invocationId: string
  nodeId: string
  scopePath: string
  attempt: number
  status: 'running' | 'success' | 'failed' | 'stopped'
  startedAt: string
}

export interface Execution {
  workflow_snapshot?: Workflow | null
  input?: unknown
  error?: string
  start_state?: string
  id?: number
  workflow_id: number
  status: 'running' | 'success' | 'failed' | 'stopped'
  context: ExecutionContext
  logs: ExecutionLog[]
  result: any
  started_at?: string
  ended_at?: string
  nodeRuns?: NodeRun[]
  sync_warning?: string
  last_event_id?: number
}

export interface WorkflowSummary {
  id: number
  name: string
  description?: string
  is_published: boolean
  updated_at?: string
}
export interface ExecutionSummary {
  id: number
  workflow_id: number
  workflow_name: string | null
  status: Execution['status']
  started_at?: string | null
  ended_at?: string | null
  start_state?: string | null
}
export interface ExecutionPage { items: ExecutionSummary[]; total: number; page: number; pageSize: number }
export interface ExecutionQuery { page: number; pageSize: number; workflowId?: number; status?: string }

export type TypedNode = Node & { type: string; data: Record<string, any> }
