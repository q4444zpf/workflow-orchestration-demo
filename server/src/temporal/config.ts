import type { ExecutionLimits } from './contracts.js'

function positiveInteger(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${name} 必须为 1 到 ${maximum} 之间的整数`)
  return value
}
export function getExecutionLimits(): ExecutionLimits {
  return { maxOutputBytes: positiveInteger('WORKFLOW_MAX_OUTPUT_BYTES', 1048576, 16777216), maxNodeCalls: positiveInteger('WORKFLOW_MAX_NODE_CALLS', 1000, 5000) }
}
export function getEngineVersion(): string {
  const version = process.env.WORKFLOW_ENGINE_VERSION || 'v4'
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(version)) throw new Error('WORKFLOW_ENGINE_VERSION 只能包含字母、数字、下划线和连字符')
  return version
}
export function taskQueueFor(version: string): string { return `workflow-orchestration-${version}` }
export function temporalAddress(): string { return process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233' }
export function temporalNamespace(): string { return process.env.TEMPORAL_NAMESPACE || 'default' }
