import type { Workflow, FlowNode } from '../../types'
import { isValueSchema, type ValueSchema, type WorkflowVariable } from '../../../server/src/shared/parameterSchema'
import { nodeName } from '../nodePresentation'
import { isRecord } from '../../../server/src/shared/parameterSchema'
import type { WorkflowValidationIssue } from '../../../server/src/shared/workflowValidation'
export interface ValueSource { id: string; kind: 'workflow' | 'node' | 'local' | 'result'; label: string; path: string; schema?: ValueSchema }
export interface SourceReference { kind: 'workflow' | 'node' | 'local' | 'result'; id: string; field: string }
export function parseSource(path: string): SourceReference | undefined {
  const parts = path.split('.')
  if (path === 'var') return { kind: 'workflow', id: '', field: '' }
  if (parts[0] === 'var' && parts[1]) return { kind: parts[1] === 'item' ? 'local' : 'workflow', id: parts[1], field: parts.slice(2).join('.') }
  if (parts[0] === 'ctx' && parts[1] && parts[2] === 'output') return { kind: 'node', id: parts[1], field: parts.slice(3).join('.') }
  if (parts[0] === 'OUTPUT' || parts[0] === 'RESULT') return { kind: 'result', id: parts[0], field: parts.slice(1).join('.') }
  return undefined
}
export function serializeSource(source: SourceReference): string {
  const base = source.kind === 'node' ? `ctx.${source.id}.output` : source.kind === 'result' ? source.id : source.id ? `var.${source.id}` : 'var'
  return base + (source.field ? `.${source.field}` : '')
}
export function schemaFields(schema?: ValueSchema, prefix = '', depth = 0): { path: string; label: string }[] {
  if (!schema || depth > 12) return []
  if (schema.type === 'object') return (schema.properties || []).flatMap(field => {
    const path = prefix ? `${prefix}.${field.name}` : field.name
    return [{ path, label: path.split('.').join(' → ') }, ...schemaFields(field, path, depth + 1)]
  })
  return []
}
function schemaAtField(schema: ValueSchema | undefined, field: string): ValueSchema | undefined {
  let current = schema
  for (const part of field.split('.').filter(Boolean)) current = current?.type === 'array' && /^\d+$/.test(part) ? current.items : current?.type === 'object' ? current.properties?.find(item => item.name === part) : undefined
  return current
}
export function outputSchema(node: FlowNode, workflow: Workflow): ValueSchema | undefined {
  if (isValueSchema(node.data.outputSchema)) return node.data.outputSchema
  const fields: WorkflowVariable[] = []
  if (node.type === 'start') {
    const mappings = Object.entries(node.data.inputMapping || {})
    if (!mappings.length) return { type: 'object', properties: workflow.variables || [] }
    for (const [name, path] of mappings) {
      const ref = typeof path === 'string' ? parseSource(path) : undefined
      const root = ref?.kind === 'workflow' ? ref.id ? workflow.variables?.find(field => field.name === ref.id) : { type: 'object' as const, properties: workflow.variables || [] } : undefined
      const selected = schemaAtField(root, ref?.field || '')
      fields.push({ ...selected, name, type: selected?.type || 'object' })
    }
  } else if (node.data.outputMapping) {
    for (const name of Object.keys(node.data.outputMapping)) fields.push({ name, type: 'object' })
  } else if (node.type === 'http') return { type: 'object', properties: [{ name: 'status', type: 'number' }, { name: 'headers', type: 'object' }, { name: 'data', type: 'object' }] }
  else if (node.type === 'loop') return { type: 'array' }
  else if (node.type === 'branch') return node.data.branches ? { type: 'object', properties: [{ name: 'branchId', type: 'string' }, { name: 'label', type: 'string' }] } : { type: 'boolean' }
  else if (node.type === 'parallel') return { type: 'object' }
  return { type: 'object', properties: fields }
}
export function availableSources(workflow: Workflow, targetId: string): ValueSource[] {
  const parameters: ValueSource[] = (workflow.variables || []).filter(field => field.name).map(field => ({ id: field.name, kind: 'workflow', label: field.name + (field.description ? ` · ${field.description}` : ''), path: `var.${field.name}`, schema: field }))
  parameters.push({ id: '', kind: 'workflow', label: '全部工作流参数', path: 'var', schema: { type: 'object', properties: workflow.variables || [] } })
  const start = workflow.nodes.find(node => node.type === 'start')
  if (!start) return parameters
  const entries = new Map<string, { env: Set<string>; loops: string[] }>()
  const queue = [{ id: start.id, env: new Set<string>(), loops: [] as string[] }]
  let steps = 0
  while (queue.length && steps++ < 20000) {
    const entry = queue.shift()!
    const previous = entries.get(entry.id)
    const env = previous ? new Set([...previous.env].filter(id => entry.env.has(id))) : entry.env
    const loops = previous ? previous.loops.filter(id => entry.loops.includes(id)) : entry.loops
    if (previous && env.size === previous.env.size && loops.length === previous.loops.length) continue
    entries.set(entry.id, { env, loops })
    const node = workflow.nodes.find(node => node.id === entry.id)
    if (!node || node.type === 'end') continue
    const after = new Set([...env, node.id])
    for (const edge of workflow.edges.filter(edge => edge.source === node.id)) {
      const body = node.type === 'loop' && edge.label === 'body'
      const fork = node.type === 'parallel' && edge.label?.startsWith('fork-')
      queue.push({ id: edge.target, env: fork ? new Set(env) : new Set(after), loops: body ? [...loops, node.id] : [...loops] })
    }
  }
  const state = entries.get(targetId)
  function itemSchema(loop: FlowNode, seen = new Set<string>()): ValueSchema | undefined {
    if (seen.has(loop.id)) return undefined
    seen.add(loop.id)
    const ref = parseSource(String(loop.data.iteratorExpression || ''))
    if (!ref) return undefined
    let schema: ValueSchema | undefined
    if (ref.kind === 'workflow') schema = ref.id ? workflow.variables?.find(field => field.name === ref.id) : { type: 'object', properties: workflow.variables || [] }
    if (ref.kind === 'node') { const source = workflow.nodes.find(node => node.id === ref.id); if (source) schema = state?.loops.includes(source.id) ? itemSchema(source, seen) : outputSchema(source, workflow) }
    return schemaAtField(schema, ref.field)?.items
  }
  const nodes: ValueSource[] = workflow.nodes.filter(node => state?.env.has(node.id) && node.id !== targetId).map(node => ({ id: node.id, kind: 'node', label: `${nodeName(node)}${state?.loops.includes(node.id) ? '（当前元素）' : ''} · ${node.id}`, path: `ctx.${node.id}.output`, schema: state?.loops.includes(node.id) ? itemSchema(node) : outputSchema(node, workflow) }))
  const innerLoop = workflow.nodes.find(node => node.id === (state ? state.loops[state.loops.length - 1] : undefined))
  const locals: ValueSource[] = state?.loops.length ? [{ id: 'item', kind: 'local', label: '当前循环元素', path: 'var.item', schema: innerLoop ? itemSchema(innerLoop) : undefined }] : []
  return [...parameters.filter(source => !locals.length || source.id !== 'item'), ...nodes, ...locals]
}

function knownField(schema: ValueSchema | undefined, path: string): boolean {
  let current = schema
  for (const part of path.split('.').filter(Boolean)) {
    if (!current) return true
    if (current.type === 'object') {
      if (current.properties === undefined) return true
      current = current.properties.find(field => field.name === part)
      if (!current) return false
    } else if (current.type === 'array') {
      if (!/^\d+$/.test(part)) return false
      current = current.items
    } else return false
  }
  return true
}
export function invalidReferenceIssues(workflow: Workflow): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = []
  for (const node of workflow.nodes) {
    const sources = availableSources(workflow, node.id).sort((a, b) => b.path.length - a.path.length)
    function check(path: unknown, label: string) {
      if (typeof path !== 'string') return
      const source = sources.find(root => path === root.path || path.startsWith(root.path + '.'))
      const suffix = source ? path.slice(source.path.length).replace(/^\./, '') : ''
      if (!path || !source || !knownField(source.schema, suffix)) issues.push({ code: 'INPUT_SOURCE', nodeId: node.id, message: `节点“${nodeName(node)}”的${label}来源不可用，请重新选择。` })
    }
    function mappings(value: unknown, label: string) { if (isRecord(value)) for (const [key, path] of Object.entries(value)) check(path, `${label}“${key}”`) }
    function template(value: unknown) { if (typeof value === 'string') for (const match of value.matchAll(/\{\{(.+?)\}\}/g)) check(match[1].trim(), '请求参数') }
    function request(binding: unknown) {
      if (!isRecord(binding)) return
      if (binding.kind === 'reference') check(binding.path, '请求参数')
      if (binding.kind === 'template') template(binding.value)
      if (binding.kind === 'object' && isRecord(binding.fields)) Object.values(binding.fields).forEach(request)
      if (binding.kind === 'array' && Array.isArray(binding.items)) binding.items.forEach(request)
    }
    mappings(node.data.inputMapping, '输入字段')
    mappings(node.data.resultMapping, '结果字段')
    if (node.data.resultExpression) check(node.data.resultExpression, '最终结果')
    if (node.data.iteratorExpression) check(node.data.iteratorExpression, '循环数组')
    request(node.data.requestBody)
    if (isRecord(node.data.requestHeaders)) Object.values(node.data.requestHeaders).forEach(request)
    if (isRecord(node.data.requestQuery)) Object.values(node.data.requestQuery).forEach(request)
    if (node.type === 'http') { template(node.data.url); if (isRecord(node.data.headers)) Object.values(node.data.headers).forEach(template); if (!node.data.requestBody) template(node.data.body) }
  }
  return issues
}
