import { isRecord } from './parameterSchema.js'
export type RequestValue = { kind: 'literal'; value: unknown } | { kind: 'template'; value: string } | { kind: 'reference'; path: string } | { kind: 'object'; fields: Record<string, RequestValue> } | { kind: 'array'; items: RequestValue[] }
export function isRequestValue(value: unknown, depth = 0): value is RequestValue {
  if (!isRecord(value) || depth > 12) return false
  return value.kind === 'literal' && Object.prototype.hasOwnProperty.call(value, 'value') ||
    value.kind === 'template' && typeof value.value === 'string' || value.kind === 'reference' && typeof value.path === 'string' ||
    value.kind === 'object' && isRecord(value.fields) && Object.values(value.fields).every(item => isRequestValue(item, depth + 1)) ||
    value.kind === 'array' && Array.isArray(value.items) && value.items.every(item => isRequestValue(item, depth + 1))
}
export function toRequestValue(value: unknown, templates = false): RequestValue {
  if (Array.isArray(value)) return { kind: 'array', items: value.map(item => toRequestValue(item, templates)) }
  if (isRecord(value)) return { kind: 'object', fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toRequestValue(item, templates)])) }
  if (templates && typeof value === 'string') return { kind: 'template', value }
  return { kind: 'literal', value }
}
