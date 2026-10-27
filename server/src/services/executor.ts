import { Workflow, FlowNode, FlowEdge, Execution, ExecutionLog, ExecutionContext, NodeExecutionState } from '../types/index.js'
import { runPythonCode } from './dockerRunner.js'
import { callHttpApi } from './httpProxy.js'
import vm from 'vm'

export function evaluateTemplate(template: string, ctx: any): any {
  if (typeof template !== 'string') return template
  if (!template.includes('{{')) return template
  return template.replace(/\{\{(.+?)\}\}/g, (_, expr) => {
    const value = evaluatePath(expr.trim(), ctx)
    return value === undefined ? '' : JSON.stringify(value)
  })
}

export function evaluatePath(expr: string, ctx: any): any {
  const parts = expr.split('.')
  let value = ctx
  for (const part of parts) {
    if (value == null) return undefined
    value = value[part]
  }
  return value
}

function renameVarIdentifier(expr: string): string {
  // Replace the standalone identifier `var` with a safe alias, but only
  // outside of string literals. This keeps the user-facing `var.xxx` syntax
  // working without corrupting values like 'var' inside strings.
  let result = ''
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      result += quote
      i++
      while (i < expr.length) {
        const c = expr[i]
        result += c
        if (c === '\\') {
          i++
          if (i < expr.length) {
            result += expr[i]
            i++
          }
        } else if (c === quote) {
          i++
          break
        } else {
          i++
        }
      }
    } else if (/\w/.test(ch)) {
      let word = ''
      while (i < expr.length && /[\w$]/.test(expr[i])) {
        word += expr[i]
        i++
      }
      result += word === 'var' ? '__var' : word
    } else {
      result += ch
      i++
    }
  }
  return result
}

export function evaluateCondition(expr: string, ctx: any): boolean {
  // The context exposes workflow variables as `var`, but `var` is a reserved
  // word and cannot be referenced directly in a JS expression. We rewrite
  // standalone `var` identifiers to `__var` and run the expression in an
  // isolated VM context with a timeout.
  const safeExpr = renameVarIdentifier(expr)
  const result = vm.runInNewContext(
    `(function () { return (${safeExpr}); })()`,
    { __var: ctx.var, ctx: ctx.ctx },
    { timeout: 1000 }
  )
  return Boolean(result)
}

export type EventHandler = (event: { type: string; nodeId: string; data?: any }) => void

export async function executeWorkflow(
  workflow: Workflow,
  variables: Record<string, any>,
  onEvent?: EventHandler
): Promise<Execution> {
  const nodes = workflow.nodes
  const edges = workflow.edges
  const startNode = nodes.find((n) => n.type === 'start')
  if (!startNode) throw new Error('Workflow must have a start node')

  const context: ExecutionContext = {}
  const logs: ExecutionLog[] = []
  const execution: Execution = {
    workflow_id: workflow.id!,
    status: 'running',
    context,
    logs,
    result: null
  }

  function log(level: ExecutionLog['level'], nodeId: string, message: string) {
    const entry = { time: new Date().toISOString(), nodeId, level, message }
    logs.push(entry)
    onEvent?.({ type: 'log', nodeId, data: entry })
  }

  function setNodeState(nodeId: string, state: Partial<NodeExecutionState>) {
    if (!context[nodeId]) context[nodeId] = { input: null, output: null, status: 'pending' }
    Object.assign(context[nodeId], state)
    onEvent?.({ type: 'state', nodeId, data: context[nodeId] })
  }

  const ctx = { var: variables, ctx: context }

  async function visit(nodeId: string): Promise<string | null> {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return null

    const incomingEdges = edges.filter((e) => e.target === nodeId)
    const input: Record<string, any> = {}
    for (const edge of incomingEdges) {
      const sourceState = context[edge.source]
      if (sourceState?.status === 'success') {
        input[edge.source] = sourceState.output
      }
    }

    setNodeState(nodeId, { input, status: 'running', startedAt: new Date().toISOString() })
    log('info', nodeId, `Start executing ${node.type}`)

    try {
      const output = await executeNode(node, input, ctx)
      setNodeState(nodeId, { output, status: 'success', endedAt: new Date().toISOString() })
      log('info', nodeId, `Finished ${node.type}`)

      const outgoingEdges = edges.filter((e) => e.source === nodeId)
      const nextEdge = chooseNextEdge(node, outgoingEdges, output)
      if (!nextEdge) return nodeId
      return visit(nextEdge.target)
    } catch (err: any) {
      setNodeState(nodeId, { status: 'failed', error: err.message, endedAt: new Date().toISOString() })
      log('error', nodeId, err.message)
      throw err
    }
  }

  async function executeNode(node: FlowNode, input: any, ctx: any): Promise<any> {
    switch (node.type) {
      case 'start':
        return node.data.inputMapping ? mapValues(node.data.inputMapping, ctx) : input
      case 'end':
        return node.data.resultExpression ? evaluatePath(node.data.resultExpression, ctx) : input
      case 'http':
        return callHttpApi({
          method: node.data.method || 'GET',
          url: node.data.url,
          headers: node.data.headers || {},
          body: node.data.body,
          timeout: node.data.timeout || 30000
        }, ctx)
      case 'python': {
        const pythonInputs: Record<string, any> = {}
        if (node.data.inputMapping) {
          for (const [varName, expr] of Object.entries(node.data.inputMapping)) {
            pythonInputs[varName] = evaluatePath(expr as string, ctx)
          }
        }
        const result = await runPythonCode(node.data.code, pythonInputs)
        if (!result.success) throw new Error(result.error)
        const output: Record<string, any> = {}
        if (node.data.outputMapping) {
          for (const [key, varName] of Object.entries(node.data.outputMapping)) {
            output[key] = varName === node.data.outputVar ? result.output : undefined
          }
        }
        return output
      }
      case 'branch':
        return evaluateCondition(node.data.condition, ctx)
      case 'loop':
        return executeLoop(node, ctx)
      case 'parallel':
        return executeParallel(node, ctx)
      default:
        throw new Error(`Unknown node type: ${node.type}`)
    }
  }

  function chooseNextEdge(node: FlowNode, edges: FlowEdge[], output: any): FlowEdge | undefined {
    if (node.type === 'branch') {
      return edges.find((e) => e.label === (output ? 'true' : 'false'))
    }
    if (node.type === 'parallel') {
      return edges.find((e) => e.label === 'join')
    }
    if (node.type === 'loop') {
      return edges.find((e) => e.label === 'next')
    }
    return edges[0]
  }

  async function executeLoop(node: FlowNode, ctx: any): Promise<any> {
    const iterator = evaluatePath(node.data.iteratorExpression, ctx)
    if (!Array.isArray(iterator)) throw new Error('Loop iterator must be an array')
    const bodyEdge = edges.find((e) => e.source === node.id && e.label === 'body')
    if (!bodyEdge) throw new Error('Loop node must have a body edge')

    const results: any[] = []
    for (const item of iterator) {
      ctx.var.item = item
      if (!ctx.ctx[node.id]) {
        ctx.ctx[node.id] = { input: item, output: item, status: 'running' }
      } else {
        ctx.ctx[node.id].input = item
        ctx.ctx[node.id].output = item
      }

      const lastNodeId = await visit(bodyEdge.target)
      if (lastNodeId) {
        results.push(ctx.ctx[lastNodeId]?.output)
      }
    }
    return results
  }

  async function executeParallel(node: FlowNode, ctx: any): Promise<any> {
    const forkEdges = edges
      .filter((e) => e.source === node.id && e.label?.startsWith('fork-'))
      .sort((a, b) => {
        const ai = parseInt(a.label!.replace('fork-', ''), 10)
        const bi = parseInt(b.label!.replace('fork-', ''), 10)
        return ai - bi
      })
    if (forkEdges.length === 0) throw new Error('Parallel node must have at least one fork edge')

    const lastNodeIds = await Promise.all(forkEdges.map((edge) => visit(edge.target)))
    const outputs: Record<string, any> = {}
    for (let i = 0; i < forkEdges.length; i++) {
      const lastNodeId = lastNodeIds[i]
      outputs[forkEdges[i].label!] = lastNodeId ? ctx.ctx[lastNodeId]?.output : undefined
    }
    return outputs
  }

  function mapValues(mapping: Record<string, string>, ctx: any): Record<string, any> {
    const result: Record<string, any> = {}
    for (const [key, expr] of Object.entries(mapping)) {
      result[key] = evaluatePath(expr, ctx)
    }
    return result
  }

  try {
    const endNodeId = await visit(startNode.id)
    execution.status = 'success'
    if (endNodeId) {
      execution.result = context[endNodeId]?.output
    }
  } catch (err: any) {
    execution.status = 'failed'
    execution.result = { error: err.message }
  }

  execution.ended_at = new Date().toISOString()
  return execution
}
