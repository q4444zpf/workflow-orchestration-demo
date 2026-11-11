import { describe, it, expect } from 'vitest'
import { resolveParameterValues, validateParameterDefinitions } from '../src/shared/parameterSchema.js'

describe('可视化参数结构', () => {
  it('默认false、0、空字符串以及嵌套数组对象保持类型，并逐级补默认值', () => {
    const definitions = [
      { name: 'enabled', type: 'boolean', default: false },
      { name: 'score', type: 'number', default: 0 },
      { name: 'note', type: 'string', default: '' },
      { name: 'users', type: 'array', items: { type: 'object', properties: [
        { name: 'name', type: 'string', required: true }, { name: 'age', type: 'number', default: 18 }
      ] } }
    ]
    expect(resolveParameterValues(definitions, { users: [{ name: '张三' }] })).toEqual({
      values: { enabled: false, score: 0, note: '', users: [{ name: '张三', age: 18 }] }, issues: []
    })
  })
  it('按路径返回必填与深层类型错误，不将字符串隐式转换为数字', () => {
    const definitions = [{ name: 'users', type: 'array', required: true, items: { type: 'object', properties: [
      { name: 'name', type: 'string', required: true }, { name: 'score', type: 'number' }
    ] } }]
    expect(resolveParameterValues(definitions, {}).issues).toMatchObject([{ path: 'users' }])
    expect(resolveParameterValues(definitions, { users: [{ score: '90' }] }).issues.map(issue => issue.path)).toEqual(['users.0.name', 'users.0.score'])
  })
  it('拒绝重复字段和非法默认值，旧无结构对象/数组仍接受原始值', () => {
    expect(validateParameterDefinitions([{ name: 'x', type: 'number' }, { name: 'x', type: 'string' }])).not.toHaveLength(0)
    expect(validateParameterDefinitions([{ name: 'x', type: 'number', default: '错误' }])).not.toHaveLength(0)
    expect(resolveParameterValues([{ name: 'obj', type: 'object' }, { name: 'items', type: 'array' }], { obj: { a: 1 }, items: [1, 'b'] }).issues).toEqual([])
  })
})
