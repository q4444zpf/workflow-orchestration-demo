// 模板和节点映射共用路径解析，各调用方保留自己的序列化规则。
export function evaluatePath(expr: string, context: unknown): unknown {
  if (typeof expr !== 'string') throw new Error('Expression path must be a string')
  let value = context
  for (const part of expr.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined
    value = Reflect.get(value, part)
  }
  return value
}
