export type ParameterType = 'string' | 'number' | 'boolean' | 'array' | 'object'
export interface ValueSchema {
  type: ParameterType
  properties?: WorkflowVariable[]
  items?: ValueSchema
}
export interface WorkflowVariable extends ValueSchema {
  name: string
  required?: boolean
  default?: unknown
  description?: string
}
export interface ParameterIssue { path: string; message: string }
const types = new Set(['string', 'number', 'boolean', 'array', 'object'])
export const parameterTypeLabels: Record<ParameterType, string> = { string: '文本', number: '数字', boolean: '布尔', object: '对象', array: '数组' }
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const safeName = (name: string) => Boolean(name.trim()) && !name.includes('.') && !['__proto__', 'constructor', 'prototype'].includes(name)

export function isValueSchema(value: unknown, depth = 0): value is ValueSchema {
  return depth <= 12 && isRecord(value) && typeof value.type === 'string' && types.has(value.type) &&
    (value.properties === undefined || Array.isArray(value.properties) && value.properties.every(item => isVariable(item, depth + 1))) &&
    (value.items === undefined || isValueSchema(value.items, depth + 1))
}
function isVariable(value: unknown, depth = 0): value is WorkflowVariable {
  return isValueSchema(value, depth) && 'name' in value && typeof value.name === 'string' &&
    (!('required' in value) || typeof value.required === 'boolean') && (!('description' in value) || typeof value.description === 'string')
}
function copy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copy)
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]))
  return value
}

function resolveValue(schema: ValueSchema, value: unknown, path: string, issues: ParameterIssue[], depth = 0): unknown {
  if (depth > 12) { issues.push({ path, message: '参数嵌套不能超过 12 层' }); return value }
  const valid = schema.type === 'array' ? Array.isArray(value) : schema.type === 'object' ? isRecord(value)
    : typeof value === schema.type && (typeof value !== 'number' || Number.isFinite(value))
  if (!valid) { issues.push({ path, message: `${path} 必须是${parameterTypeLabels[schema.type]}` }); return value }
  if (schema.type === 'object' && isRecord(value) && schema.properties) return resolveFields(schema.properties, value, path, issues, depth + 1)
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    const itemSchema = schema.items
    return value.map((item, index) => resolveValue(itemSchema, item, `${path}.${index}`, issues, depth + 1))
  }
  return copy(value)
}
function resolveFields(fields: WorkflowVariable[], input: Record<string, unknown>, prefix: string, issues: ParameterIssue[], depth: number): Record<string, unknown> {
  const values = { ...input }
  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name
    const value = Object.prototype.hasOwnProperty.call(input, field.name) ? input[field.name] : field.default
    if (value === undefined) { if (field.required) issues.push({ path, message: `${path} 为必填参数` }); continue }
    if (field.required && typeof value === 'string' && !value.trim()) issues.push({ path, message: `${path} 不能为空` })
    Object.defineProperty(values, field.name, { value: resolveValue(field, value, path, issues, depth), enumerable: true, writable: true, configurable: true })
  }
  return values
}
export function validateParameterDefinitions(definitions: unknown): ParameterIssue[] {
  if (definitions === undefined) return []
  if (!Array.isArray(definitions)) return [{ path: 'parameters', message: '参数定义必须是字段列表' }]
  const issues: ParameterIssue[] = []
  function check(fields: unknown[], prefix: string, depth: number) {
    const seen = new Set<string>()
    fields.forEach((value, index) => {
      const path = `${prefix}${index}`
      if (!isVariable(value, depth)) { issues.push({ path, message: '参数结构无效或嵌套超过 12 层' }); return }
      if (!safeName(value.name) || seen.has(value.name)) issues.push({ path, message: '参数名须非空、唯一且不能含点号或保留名称' })
      seen.add(value.name)
      if (value.default !== undefined) resolveValue(value, value.default, `${value.name}.默认值`, issues)
      function children(schema: ValueSchema, nested: number) {
        if (schema.properties) check(schema.properties, `${path}.`, nested)
        if (schema.items) children(schema.items, nested + 1)
      }
      children(value, depth + 1)
    })
  }
  check(definitions, '', 0)
  return issues
}
export function resolveParameterValues(definitions: unknown, inputs: unknown): { values: Record<string, unknown>; issues: ParameterIssue[] } {
  const issues = validateParameterDefinitions(definitions)
  if (!isRecord(inputs)) return { values: {}, issues: [...issues, { path: 'parameters', message: '运行参数必须是对象' }] }
  if (issues.length || definitions === undefined) return { values: { ...inputs }, issues }
  const fields = Array.isArray(definitions) ? definitions.filter(item => isVariable(item)) : []
  return { values: resolveFields(fields, inputs, '', issues, 0), issues }
}
export function inferValueSchema(value: unknown): ValueSchema {
  if (Array.isArray(value)) return { type: 'array', items: value.length ? inferValueSchema(value[0]) : { type: 'string' } }
  if (isRecord(value)) return { type: 'object', properties: Object.entries(value).map(([name, item]) => ({ name, ...inferValueSchema(item) })) }
  return { type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string' }
}
export function emptyValue(schema: ValueSchema): unknown {
  return schema.type === 'object' ? {} : schema.type === 'array' ? [] : schema.type === 'boolean' ? false : schema.type === 'number' ? 0 : ''
}
