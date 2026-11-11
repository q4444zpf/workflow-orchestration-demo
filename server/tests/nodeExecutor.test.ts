import { describe, expect, it, vi } from 'vitest'
import { executeTaskNode } from '../src/services/nodeExecutor.js'
import { callHttpApi } from '../src/services/httpProxy.js'
import { runPythonCode } from '../src/services/dockerRunner.js'
import type { FlowNode } from '../src/types/index.js'

vi.mock('../src/services/httpProxy.js', () => ({ callHttpApi: vi.fn() }))
vi.mock('../src/services/dockerRunner.js', () => ({ runPythonCode: vi.fn() }))

const context = { var: { amount: 42 }, ctx: {} }
const node = (type: string, data: FlowNode['data'] = {}): FlowNode => ({ id: 'task', type, position: { x: 0, y: 0 }, data })

describe('单次节点执行边界', () => {
  it('Python输出可选取OUTPUT子字段，保留false和完整结果', async () => {
    vi.mocked(runPythonCode).mockResolvedValueOnce({ success: true, output: { score: 90, passed: false }, logs: '' })
    expect(await executeTaskNode(node('python', { code: 'OUTPUT = {}', outputVar: 'OUTPUT', outputMapping: { score: 'OUTPUT.score', passed: 'OUTPUT.passed', all: 'OUTPUT' } }), {}, context)).toEqual({ score: 90, passed: false, all: { score: 90, passed: false } })
  })
  it('HTTP投影及结束节点组合输出按配置选择来源', async () => {
    vi.mocked(callHttpApi).mockResolvedValueOnce({ status: 200, data: { score: 0 }, headers: {} })
    expect(await executeTaskNode(node('http', { url: 'http://localhost/test', outputMapping: { score: 'RESULT.data.score' } }), {}, context)).toEqual({ score: 0 })
    expect(await executeTaskNode(node('end', { resultMapping: { amount: 'var.amount', passed: 'ctx.py.output.passed' } }), {}, { ...context, ctx: { py: { input: {}, output: { passed: false }, status: 'success' } } })).toEqual({ amount: 42, passed: false })
  })
  it('HTTP请求绑定保留数字、布尔、嵌套对象与查询参数类型', async () => {
    vi.mocked(callHttpApi).mockResolvedValueOnce({ status: 200, data: {}, headers: {} })
    await executeTaskNode(node('http', { method: 'POST', url: 'http://localhost/test',
      requestQuery: { q: { kind: 'reference', path: 'var.amount' } },
      requestHeaders: { 'X-Score': { kind: 'reference', path: 'var.amount' } },
      requestBody: { kind: 'object', fields: { score: { kind: 'reference', path: 'var.amount' }, active: { kind: 'literal', value: false }, items: { kind: 'array', items: [{ kind: 'literal', value: 0 }] } } }
    }), {}, context)
    expect(callHttpApi).toHaveBeenLastCalledWith(expect.objectContaining({ body: { score: 42, active: false, items: [0] }, params: { q: 42 }, resolvedHeaders: { 'X-Score': '42' }, bodyIsValue: true }), context)
  })
  it.each([undefined, {}])('开始节点缺省或空映射均透传全部运行参数：%j', async inputMapping => {
    const variables = { score: 90, enabled: false, note: '', nested: { region: '西区' } }
    expect(await executeTaskNode(node('start', { inputMapping }), variables, { var: variables, ctx: {} })).toEqual({
      score: 90, enabled: false, note: '', nested: { region: '西区' }
    })
  })
  it('开始节点映射变量，结束节点保留 false 等合法结果', async () => {
    expect(await executeTaskNode(node('start', { inputMapping: { amount: 'var.amount' } }), {}, context)).toEqual({ amount: 42 })
    expect(await executeTaskNode(node('end', { resultExpression: 'var.answer' }), {}, { var: { answer: false }, ctx: {} })).toBe(false)
  })
  it('HTTP 节点保留模板、参数与失败传播', async () => {
    vi.mocked(callHttpApi).mockResolvedValueOnce({ status: 200, data: { ok: true }, headers: {} })
    const task = node('http', { url: 'https://example.test/{{var.amount}}', method: 'POST', body: '{"amount": 42}', timeout: 300 })
    expect(await executeTaskNode(task, {}, context)).toEqual({ status: 200, data: { ok: true }, headers: {} })
    expect(callHttpApi).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', url: 'https://example.test/{{var.amount}}', timeout: 300 }), context)
    vi.mocked(callHttpApi).mockRejectedValueOnce(new Error('请求失败'))
    await expect(executeTaskNode(task, {}, context)).rejects.toThrow('请求失败')
  })
  it('Python 节点保留输入和输出映射，并传播代码错误', async () => {
    vi.mocked(runPythonCode).mockResolvedValueOnce({ success: true, output: 84, logs: '' })
    const task = node('python', { code: 'OUTPUT = amount * 2', inputMapping: { amount: 'var.amount' }, outputVar: 'OUTPUT', outputMapping: { result: 'OUTPUT' } })
    expect(await executeTaskNode(task, {}, context)).toEqual({ result: 84 })
    expect(runPythonCode).toHaveBeenCalledWith('OUTPUT = amount * 2', { amount: 42 })
    vi.mocked(runPythonCode).mockResolvedValueOnce({ success: false, output: null, logs: '', error: '代码错误' })
    await expect(executeTaskNode(task, {}, context)).rejects.toThrow('代码错误')
  })
  it('条件保持布尔值约定，不吞掉表达式异常', async () => {
    expect(await executeTaskNode(node('branch', { condition: 'var.amount > 40' }), {}, context)).toBe(true)
    await expect(executeTaskNode(node('branch', { condition: '42' }), {}, context)).rejects.toThrow('boolean')
    await expect(executeTaskNode(node('branch', { condition: '(' }), {}, context)).rejects.toThrow()
  })
  it.each(['loop', 'parallel'])('%s 必须由调度器处理，不能在单次节点执行中递归', async type => {
    await expect(executeTaskNode(node(type), {}, context)).rejects.toThrow('调度')
  })
})
