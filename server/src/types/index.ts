import type { BranchDefinition } from '../shared/branches.js'
import type { WorkflowVariable } from '../shared/parameterSchema.js'
import type { ValueSchema } from '../shared/parameterSchema.js'
import type { RequestValue } from '../shared/requestValues.js'
export type { WorkflowVariable } from '../shared/parameterSchema.js'

export interface Position {
  x: number
  y: number
}

export interface NodeConfig {
  label?: string
  inputMapping?: Record<string, string>
  outputMapping?: Record<string, string>
  resultExpression?: string
  resultMapping?: Record<string, string>
  outputSchema?: ValueSchema
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  url?: string
  headers?: Record<string, string>
  body?: unknown
  requestBody?: RequestValue
  requestQuery?: Record<string, RequestValue>
  requestHeaders?: Record<string, RequestValue>
  timeout?: number
  code?: string
  outputVar?: string
  condition?: string
  branches?: BranchDefinition[]
  retry?: { maxAttempts?: number }
  idempotent?: boolean
  iteratorExpression?: string
}

export interface FlowNode {
  id: string
  type: string
  position: Position
  data: NodeConfig
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  label?: string
  branchId?: string
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

export interface RegisteredApi {
  id?: number
  name: string
  description?: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  url: string
  headers?: Record<string, string>
  sample_params?: unknown
  output_schema?: unknown
}

export interface ExecutionLog {
  time: string
  nodeId: string
  level: 'info' | 'error' | 'debug'
  message: string
}

export interface NodeExecutionState {
  input: unknown
  output: unknown
  status: 'pending' | 'running' | 'success' | 'failed' | 'stopped'
  startedAt?: string
  endedAt?: string
  error?: string
}

export interface ExecutionContext {
  [nodeId: string]: NodeExecutionState
}

export interface Execution {
  workflow_snapshot?: Workflow | null
  input?: unknown
  error?: string
  last_event_id?: number
  id?: number
  workflow_id: number
  status: 'running' | 'success' | 'failed' | 'stopped'
  context: ExecutionContext
  logs: ExecutionLog[]
  result: unknown
  started_at?: string
  ended_at?: string
  nodeRuns?: NodeRun[]
  engine_version?: string | null
  temporal_workflow_id?: string | null
  start_state?: string
}

export interface NodeRun {
  invocationId: string
  nodeId: string
  scopePath: string
  attempt: number
  status: 'running' | 'success' | 'failed' | 'stopped'
  input: unknown
  output: unknown
  startedAt: string
  endedAt?: string
  error?: string
}
