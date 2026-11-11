import type { FlowEdge } from '../types/index.js'

export interface ExecutionLimits { maxOutputBytes: number; maxNodeCalls: number }
export interface RuntimeNode { id: string; type: string; timeoutMs: number; maximumAttempts: number }
export interface ExecutionPlan { nodes: RuntimeNode[]; edges: FlowEdge[]; limits: ExecutionLimits }
export interface WorkflowInput { executionId: number; engineVersion: string }
export interface NodeCall {
  executionId: number
  nodeId: string
  invocationId: string
  scopePath: string
  sequence: number
  contextRef: string | null
  contextOverrides?: Record<string, string>
  locals: Record<string, string>
}
export interface NodeTaskResult { outputRef?: string; contextRef: string | null; route?: string; items?: string[] }
export interface CompleteControlCall {
  call: NodeCall
  resultRefs: string[] | Record<string, string>
}
export interface GraphActivities {
  loadExecutionPlan(executionId: number, engineVersion: string): Promise<ExecutionPlan>
  executeNodeActivity(call: NodeCall): Promise<NodeTaskResult>
  completeControlActivity(input: CompleteControlCall): Promise<NodeTaskResult>
  failControlActivity(call: NodeCall, status: 'failed' | 'stopped', error: string): Promise<void>
  finishExecution(executionId: number, status: 'success' | 'failed' | 'stopped', resultRef: string | null, error?: string): Promise<void>
}
