import type { ExecutionContext, FlowNode } from '../types/index.js'
import { evaluatePath } from './valuePath.js'
import { evaluateCondition, mapValues, requiredString } from './expressions.js'
import { callHttpApi } from './httpProxy.js'
import { runPythonCode } from './dockerRunner.js'
import { resolveRequestValue } from './requestValues.js'

export interface EvaluationContext { var: Record<string, unknown>; ctx: ExecutionContext }
export interface NodeExecutionOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxOutputBytes?: number
  invocationKey?: string
  idempotencyKey?: string
  onLog?: (text: string, level: 'info' | 'error') => Promise<void>
}

function project(mapping: Record<string, string>, context: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(mapping).map(([name, path]) => {
    const value = evaluatePath(path, context)
    if (value === undefined) throw new TypeError(`输出字段来源不存在：${path}`)
    return [name, value]
  }))
}

// 只执行一个节点；循环、并行和下一条路径由上层调度器决定。
export async function executeTaskNode(node: FlowNode, input: unknown, context: EvaluationContext, options?: NodeExecutionOptions): Promise<unknown> {
  switch (node.type) {
    case 'start': return node.data.inputMapping && Object.keys(node.data.inputMapping).length > 0 ? mapValues(node.data.inputMapping, context) : input
    case 'end': return node.data.resultMapping !== undefined ? project(node.data.resultMapping, context) : node.data.resultExpression ? evaluatePath(node.data.resultExpression, context) : input
    case 'branch': return evaluateCondition(requiredString(node.data.condition, 'Branch condition'), context)
    case 'http': {
      const headers = { ...node.data.headers }
      const resolvedHeaders: Record<string, string> = {}
      for (const [name, binding] of Object.entries(node.data.requestHeaders || {})) {
        const value = resolveRequestValue(binding, context)
        if (value !== null && typeof value === 'object') throw new TypeError(`请求头 ${name} 需要标量值`)
        resolvedHeaders[name] = String(value)
      }
      if (options?.idempotencyKey && node.data.idempotent === true && node.data.method !== 'GET') {
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'idempotency-key') delete headers[key]
        for (const key of Object.keys(resolvedHeaders)) if (key.toLowerCase() === 'idempotency-key') delete resolvedHeaders[key]
        headers['Idempotency-Key'] = options.idempotencyKey
      }
      const config = { method: node.data.method || 'GET', url: requiredString(node.data.url, 'URL'), headers, resolvedHeaders,
        body: node.data.requestBody === undefined ? node.data.body : resolveRequestValue(node.data.requestBody, context),
        ...(node.data.requestBody === undefined ? {} : { bodyIsValue: true }),
        ...(node.data.requestQuery === undefined ? {} : { params: Object.fromEntries(Object.entries(node.data.requestQuery).map(([key, binding]) => [key, resolveRequestValue(binding, context)])) }),
        timeout: node.data.timeout || 30000 }
      const result = options ? await callHttpApi(config, context, options) : await callHttpApi(config, context)
      return node.data.outputMapping === undefined ? result : project(node.data.outputMapping, { RESULT: result })
    }
    case 'python': {
      const inputs = node.data.inputMapping ? mapValues(node.data.inputMapping, context) : {}
      const code = requiredString(node.data.code, 'Python code')
      const result = options ? await runPythonCode(code, inputs, options) : await runPythonCode(code, inputs)
      if (result.logs) await options?.onLog?.(result.logs, result.success ? 'info' : 'error')
      if (!result.success) throw new Error(result.error)
      return project(node.data.outputMapping || {}, { OUTPUT: result.output, [node.data.outputVar || 'OUTPUT']: result.output })
    }
    case 'loop':
    case 'parallel': throw new Error(`节点 ${node.type} 必须由图调度器处理`)
    default: throw new Error(`Unknown node type: ${node.type}`)
  }
}
