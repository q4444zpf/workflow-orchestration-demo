import { describe, it, expect } from 'vitest'
import { executeWorkflow, evaluateTemplate, evaluatePath, evaluateCondition } from '../src/services/executor.js'
import { Workflow } from '../src/types/index.js'

describe('executor', () => {
  it('executes a simple linear workflow', async () => {
    const workflow: Workflow = {
      id: 1,
      name: 'test',
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { inputMapping: { value: 'var.x' } } },
        { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }]
    }
    const result = await executeWorkflow(workflow, { x: 42 })
    expect(result.status).toBe('success')
    expect(result.context.start.output.value).toBe(42)
  })

  describe('evaluateTemplate', () => {
    it('replaces expressions with JSON stringified values', () => {
      expect(evaluateTemplate('value is {{var.x}}', { var: { x: 42 } })).toBe('value is 42')
      expect(evaluateTemplate('hello {{var.name}}', { var: { name: 'Ada' } })).toBe('hello "Ada"')
    })

    it('returns non-string templates unchanged', () => {
      expect(evaluateTemplate(123 as any, {})).toBe(123)
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
    it('evaluates expressions against ctx', () => {
      expect(evaluateCondition('var.x > 10', { var: { x: 42 } })).toBe(true)
      expect(evaluateCondition('var.x === 10', { var: { x: 42 } })).toBe(false)
    })
  })
})
