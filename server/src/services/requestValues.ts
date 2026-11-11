import type { RequestValue } from '../shared/requestValues.js'
import { evaluatePath } from './valuePath.js'
export function resolveRequestValue(binding: RequestValue, context: unknown): unknown {
  if (binding.kind === 'literal') return binding.value
  if (binding.kind === 'template') return binding.value.replace(/\{\{(.+?)\}\}/g, (_, path: string) => { const value = evaluatePath(path.trim(), context); return value === undefined ? '' : String(value) })
  if (binding.kind === 'reference') { const value = evaluatePath(binding.path, context); if (value === undefined) throw new TypeError(`输入来源无有效值：${binding.path}`); return value }
  if (binding.kind === 'array') return binding.items.map(item => resolveRequestValue(item, context))
  return Object.fromEntries(Object.entries(binding.fields).map(([key, item]) => [key, resolveRequestValue(item, context)]))
}
