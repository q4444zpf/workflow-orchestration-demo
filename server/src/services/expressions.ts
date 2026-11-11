import vm from 'node:vm'
import { evaluatePath } from './valuePath.js'

export interface ExpressionContext { var: Record<string, unknown>; ctx: unknown }

export function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(name + ' must be a string')
  return value
}

export function evaluateTemplate(template: unknown, context: unknown): unknown {
  if (typeof template !== 'string' || !template.includes('{{')) return template
  return template.replace(/\{\{(.+?)\}\}/g, (_, expr: string) => {
    const value = evaluatePath(expr.trim(), context)
    return value === undefined ? '' : JSON.stringify(value)
  })
}

function renameVarIdentifier(expr: string): string {
  // 只替换字符串外的 var 标识符，兼容用户表达式中的 var.xxx 语法。
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
          if (i < expr.length) { result += expr[i]; i++ }
        } else if (c === quote) { i++; break }
        else i++
      }
    } else if (/\w/.test(ch)) {
      let word = ''
      while (i < expr.length && /[\w$]/.test(expr[i])) { word += expr[i]; i++ }
      result += word === 'var' ? '__var' : word
    } else { result += ch; i++ }
  }
  return result
}

export function evaluateCondition(expr: string, context: ExpressionContext): boolean {
  // Node vm 只在单次节点/Activity 中使用，不进入 Temporal Workflow bundle。
  const result: unknown = vm.runInNewContext(
    `(function () { return (${renameVarIdentifier(expr)}); })()`,
    { __var: context.var, ctx: context.ctx },
    { timeout: 1000 }
  )
  if (typeof result !== 'boolean') throw new Error('Branch condition must return a boolean')
  return result
}

export function mapValues(mapping: Record<string, string>, context: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(mapping).map(([key, path]) => [key, evaluatePath(path, context)]))
}
