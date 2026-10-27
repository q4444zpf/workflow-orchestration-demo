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

  describe('branch control flow', () => {
    function buildBranchWorkflow(condition: string): Workflow {
      return {
        id: 1,
        name: 'branch-test',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'branch', type: 'branch', position: { x: 100, y: 0 }, data: { condition } },
          { id: 'trueEnd', type: 'end', position: { x: 200, y: -50 }, data: { resultExpression: 'var.x' } },
          { id: 'falseEnd', type: 'end', position: { x: 200, y: 50 }, data: { resultExpression: 'var.y' } }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'branch' },
          { id: 'e2', source: 'branch', target: 'trueEnd', label: 'true' },
          { id: 'e3', source: 'branch', target: 'falseEnd', label: 'false' }
        ]
      }
    }

    it('follows the true edge when condition is truthy', async () => {
      const result = await executeWorkflow(buildBranchWorkflow('var.x > 10'), { x: 15, y: 0 })
      expect(result.status).toBe('success')
      expect(result.result).toBe(15)
      expect(result.context.trueEnd).toBeDefined()
      expect(result.context.falseEnd).toBeUndefined()
    })

    it('follows the false edge when condition is falsy', async () => {
      const result = await executeWorkflow(buildBranchWorkflow('var.x > 10'), { x: 5, y: 99 })
      expect(result.status).toBe('success')
      expect(result.result).toBe(99)
      expect(result.context.trueEnd).toBeUndefined()
      expect(result.context.falseEnd).toBeDefined()
    })
  })

  describe('loop control flow', () => {
    it('executes the body for each iterator item and follows the next edge', async () => {
      const workflow: Workflow = {
        id: 1,
        name: 'loop-test',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'loop', type: 'loop', position: { x: 100, y: 0 }, data: { iteratorExpression: 'var.items' } },
          { id: 'bodyEnd', type: 'end', position: { x: 200, y: -50 }, data: { resultExpression: 'var.item' } },
          { id: 'finalEnd', type: 'end', position: { x: 200, y: 50 }, data: { resultExpression: 'ctx.loop.output' } }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'loop' },
          { id: 'e2', source: 'loop', target: 'bodyEnd', label: 'body' },
          { id: 'e3', source: 'loop', target: 'finalEnd', label: 'next' }
        ]
      }
      const result = await executeWorkflow(workflow, { items: [1, 2, 3] })
      expect(result.status).toBe('success')
      expect(result.result).toEqual([1, 2, 3])
      expect(result.context.loop.output).toEqual([1, 2, 3])
      expect(result.context.bodyEnd.output).toBe(3)
    })

    it('handles an empty iterator', async () => {
      const workflow: Workflow = {
        id: 1,
        name: 'loop-empty-test',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'loop', type: 'loop', position: { x: 100, y: 0 }, data: { iteratorExpression: 'var.items' } },
          { id: 'bodyEnd', type: 'end', position: { x: 200, y: -50 }, data: { resultExpression: 'var.item' } },
          { id: 'finalEnd', type: 'end', position: { x: 200, y: 50 }, data: { resultExpression: 'ctx.loop.output' } }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'loop' },
          { id: 'e2', source: 'loop', target: 'bodyEnd', label: 'body' },
          { id: 'e3', source: 'loop', target: 'finalEnd', label: 'next' }
        ]
      }
      const result = await executeWorkflow(workflow, { items: [] })
      expect(result.status).toBe('success')
      expect(result.result).toEqual([])
    })
  })

  describe('parallel control flow', () => {
    it('runs fork branches concurrently and continues via the join edge', async () => {
      const workflow: Workflow = {
        id: 1,
        name: 'parallel-test',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
          { id: 'parallel', type: 'parallel', position: { x: 100, y: 0 }, data: {} },
          { id: 'fork0End', type: 'end', position: { x: 200, y: -50 }, data: { resultExpression: 'var.x' } },
          { id: 'fork1End', type: 'end', position: { x: 200, y: 50 }, data: { resultExpression: 'var.y' } },
          { id: 'joinEnd', type: 'end', position: { x: 300, y: 0 }, data: { resultExpression: 'ctx.parallel.output' } }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'parallel' },
          { id: 'e2', source: 'parallel', target: 'fork0End', label: 'fork-0' },
          { id: 'e3', source: 'parallel', target: 'fork1End', label: 'fork-1' },
          { id: 'e4', source: 'parallel', target: 'joinEnd', label: 'join' }
        ]
      }
      const result = await executeWorkflow(workflow, { x: 10, y: 20 })
      expect(result.status).toBe('success')
      expect(result.result).toEqual({ 'fork-0': 10, 'fork-1': 20 })
      expect(result.context.parallel.output).toEqual({ 'fork-0': 10, 'fork-1': 20 })
      expect(result.context.fork0End.output).toBe(10)
      expect(result.context.fork1End.output).toBe(20)
    })
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

    it('does not replace var inside string literals', () => {
      const ctx = { var: { x: 1 }, ctx: { foo: 'var' } }
      expect(evaluateCondition("ctx.foo === 'var'", ctx)).toBe(true)
      expect(evaluateCondition('var.x === 1 && ctx.foo === "var"', ctx)).toBe(true)
      expect(evaluateCondition("ctx.foo !== 'var'", ctx)).toBe(false)
    })
  })
})
