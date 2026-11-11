import { describe, it, expect } from 'vitest'
import { evaluateTemplate, evaluateCondition } from '../src/services/expressions.js'
import { evaluatePath } from '../src/services/valuePath.js'

describe('表达式求值', () => {
  describe('evaluateTemplate', () => {
    it('replaces expressions with JSON stringified values', () => {
      expect(evaluateTemplate('value is {{var.x}}', { var: { x: 42 } })).toBe('value is 42')
      expect(evaluateTemplate('hello {{var.name}}', { var: { name: 'Ada' } })).toBe('hello "Ada"')
    })

    it('returns non-string templates unchanged', () => {
      expect(evaluateTemplate(123, {})).toBe(123)
    })

    it('returns strings without templates unchanged', () => {
      expect(evaluateTemplate('plain text', {})).toBe('plain text')
    })

    it('replaces missing values with empty strings', () => {
      expect(evaluateTemplate('{{var.missing}}', { var: {} })).toBe('')
    })
  })

  describe('evaluatePath', () => {
    it('resolves dot-separated paths', () => {
      expect(evaluatePath('var.user.name', { var: { user: { name: 'Ada' } } })).toBe('Ada')
    })

    it('returns undefined for missing paths', () => {
      expect(evaluatePath('var.missing', { var: {} })).toBeUndefined()
    })
  })

  describe('evaluateCondition', () => {
    it.each(['"false"', '1', 'null', '({})'])('拒绝非布尔条件 %s', (expr) => {
      expect(() => evaluateCondition(expr, { var: {}, ctx: {} })).toThrow('boolean')
    })
    it('evaluates expressions against ctx', () => {
      expect(evaluateCondition('var.x > 10', { var: { x: 42 } })).toBe(true)
      expect(evaluateCondition('var.x === 10', { var: { x: 42 } })).toBe(false)
    })

    it('does not replace var inside string literals', () => {
      const ctx = { var: { x: 1 }, ctx: { foo: 'var' } }
      expect(evaluateCondition("ctx.foo === 'var'", ctx)).toBe(true)
      expect(evaluateCondition('var.x === 1 && ctx.foo === "var"', ctx)).toBe(true)
      expect(evaluateCondition("ctx.foo !== 'var'", ctx)).toBe(false)
    })
  })
})
