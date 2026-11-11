import { describe, expect, it } from 'vitest'
import { validateWorkflowGraph } from '../src/shared/workflowValidation.js'
import { getBranchDefinitions } from '../src/shared/branches.js'
import { readFileSync } from 'node:fs'

const node = (id: string, type: string) => ({ id, type, data: { label: id } })
const edge = (id: string, source: string, target: string, label?: string) => ({ id, source, target, label })
const base = () => ({ nodes: [node('start', 'start'), node('end', 'end')], edges: [edge('e', 'start', 'end')] })

describe('工作流基础结构校验', () => {
  it('现有评分示例保持可导入', () => {
    expect(validateWorkflowGraph(JSON.parse(readFileSync(new URL('../../examples/sample-workflow.json', import.meta.url), 'utf8')))).toEqual([])
  })
  it('允许一个开始节点连接结束节点', () => {
    expect(validateWorkflowGraph(base())).toEqual([])
  })
  it.each([0, 2])('拒绝 %i 个开始节点', count => {
    const graph = base()
    graph.nodes = [node('end', 'end'), ...Array.from({ length: count }, (_, i) => node(`s${i}`, 'start'))]
    expect(validateWorkflowGraph(graph)).toContainEqual(expect.objectContaining({ code: 'START_COUNT' }))
  })
  it('空图同时报告缺少开始和结束节点', () => {
    expect(validateWorkflowGraph({ nodes: [], edges: [] }).map(issue => issue.code)).toEqual(['START_COUNT', 'END_REQUIRED'])
  })
  it('拒绝重复节点 ID 和不合法的节点数据', () => {
    expect(validateWorkflowGraph({ nodes: [node('start', 'start'), node('start', 'end')], edges: [] })).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_NODE_ID', nodeId: 'start' }))
    expect(validateWorkflowGraph({ nodes: [null], edges: [] })).toContainEqual(expect.objectContaining({ code: 'INVALID_NODE' }))
    expect(validateWorkflowGraph({ nodes: [node('x', 'unknown')], edges: [] })).toContainEqual(expect.objectContaining({ code: 'INVALID_NODE' }))
  })
  it('拒绝不存在的连线端点和重复连线 ID', () => {
    const graph = base()
    graph.edges.push(edge('e', 'start', 'missing'))
    const issues = validateWorkflowGraph(graph)
    expect(issues).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_EDGE_ID', edgeId: 'e' }))
    expect(issues).toContainEqual(expect.objectContaining({ code: 'MISSING_ENDPOINT', edgeId: 'e' }))
  })
  it.each([
    ['self', 'start', 'start', 'SELF_CONNECTION'],
    ['back', 'end', 'start', 'START_INCOMING'],
    ['after', 'end', 'other', 'END_OUTGOING']
  ])('拒绝非法方向连线 %s', (id, source, target, code) => {
    const graph = base()
    graph.nodes.push(node('other', 'end'))
    graph.edges.push(edge(id, source, target))
    expect(validateWorkflowGraph(graph)).toContainEqual(expect.objectContaining({ code, edgeId: id }))
  })
  it('报告与开始节点断开的整个子图，即使子图内部有连接', () => {
    const graph = base()
    graph.nodes.push(node('orphan', 'http'), node('orphanEnd', 'end'))
    graph.edges.push(edge('other', 'orphan', 'orphanEnd'))
    expect(validateWorkflowGraph(graph).filter(issue => issue.code === 'UNREACHABLE_NODE').map(issue => issue.nodeId)).toEqual(['orphan', 'orphanEnd'])
  })
  it('合法分支可以使用两个结束节点', () => {
    const graph = { nodes: [node('s', 'start'), node('b', 'branch'), node('t', 'end'), node('f', 'end')], edges: [edge('sb', 's', 'b'), edge('bt', 'b', 't', 'true'), edge('bf', 'b', 'f', 'false')] }
    expect(validateWorkflowGraph(graph)).toEqual([])
    graph.edges.pop()
    expect(validateWorkflowGraph(graph)).toContainEqual(expect.objectContaining({ code: 'BRANCH_OUTPUTS', nodeId: 'b' }))
    graph.edges.push(edge('extra', 'b', 'f', 'true'))
    expect(validateWorkflowGraph(graph)).toContainEqual(expect.objectContaining({ code: 'BRANCH_OUTPUTS' }))
  })
  it.each(['loop', 'parallel'])('保留已有 %s 的子流程终点和出口', type => {
    expect(validateWorkflowGraph({ nodes: [node('s', 'start'), node('c', type), node('body', 'end'), node('done', 'end')], edges: [edge('sc', 's', 'c'), edge('body', 'c', 'body', type === 'loop' ? 'body' : 'fork-0'), edge('done', 'c', 'done', type === 'loop' ? 'next' : 'join')] })).toEqual([])
  })
  it('畸形数组及连线返回问题而不是抛异常', () => {
    expect(validateWorkflowGraph({ nodes: null, edges: {} }).length).toBeGreaterThan(0)
    expect(validateWorkflowGraph({ ...base(), edges: [null] })).toContainEqual(expect.objectContaining({ code: 'INVALID_EDGE' }))
  })
})

describe('共享分支定义', () => {
  it('旧条件转换为稳定 true 条件与 false 默认出口', () => {
    expect(getBranchDefinitions({ condition: 'var.score >= 80' })).toEqual([
      { id: 'true', label: 'true', condition: 'var.score >= 80' },
      { id: 'false', label: 'false', isDefault: true }
    ])
  })
  it('保留有序分支的 ID、名称和默认标记，并隔离返回值修改', () => {
    const config = { branches: [
      { id: 'high', label: '高分', condition: 'var.score >= 80' },
      { id: 'medium', label: '中等', condition: 'var.score >= 60' },
      { id: 'rest', label: '其余', isDefault: true }
    ] }
    const result = getBranchDefinitions(config)
    expect(result).toEqual([
      { id: 'high', label: '高分', condition: 'var.score >= 80' },
      { id: 'medium', label: '中等', condition: 'var.score >= 60' },
      { id: 'rest', label: '其余', isDefault: true }
    ])
    result[0].label = '改名'
    expect(config.branches[0].label).toBe('高分')
  })
  it('无效现代配置安全返回且不会退回旧 condition', () => {
    expect(getBranchDefinitions({ branches: '错误格式', condition: 'true' })).toEqual([])
    expect(getBranchDefinitions({ branches: [null, { id: 12, label: '坏ID' }, { id: 'default', label: '默认', isDefault: true }] })).toEqual([{ id: 'default', label: '默认', isDefault: true }])
  })
})

describe('结构化控制流校验', () => {
  const multiBranch = (branches: unknown) => ({
    nodes: [node('s', 'start'), { ...node('b', 'branch'), data: { branches } }, node('a', 'end'), node('d', 'end')],
    edges: [edge('sb', 's', 'b'), { ...edge('ba', 'b', 'a', '高分'), branchId: 'high' }, { ...edge('bd', 'b', 'd', '默认'), branchId: 'rest' }]
  })
  const branches = () => [{ id: 'high', label: '高分', condition: 'var.score >= 80' }, { id: 'rest', label: '默认', isDefault: true }]
  const control = (type: string) => ({
    nodes: [node('s', 'start'), node('c', type), node('a', 'http'), node('b', 'http'), node('ae', 'end'), node('be', 'end'), node('done', 'end')],
    edges: [edge('sc', 's', 'c'), edge('ca', 'c', 'a', type === 'loop' ? 'body' : 'fork-0'), edge('cb', 'c', 'b', type === 'loop' ? 'next' : 'fork-1'), edge('aa', 'a', 'ae'), edge('bb', 'b', 'be'), ...(type === 'parallel' ? [edge('cd', 'c', 'done', 'join')] : [])]
  })
  it('支持稳定分支 ID，与显示名称无关', () => {
    expect(validateWorkflowGraph(multiBranch(branches()))).toEqual([])
  })
  it('支持多个有序条件和默认出口', () => {
    const graph = multiBranch([{ id: 'high', label: '高分', condition: 'var.score >= 80' }, { id: 'medium', label: '中等', condition: 'var.score >= 60' }, { id: 'rest', label: '默认', isDefault: true }])
    graph.nodes.push(node('middleEnd', 'end'))
    graph.edges.push({ ...edge('bm', 'b', 'middleEnd', '中等'), branchId: 'medium' })
    expect(validateWorkflowGraph(graph)).toEqual([])
  })
  it.each([
    { value: [] },
    { value: [{ id: 'high', label: '高分', condition: 'true' }] },
    { value: [{ id: 'high', label: '高分', isDefault: true }, { id: 'rest', label: '默认', isDefault: true }] },
    { value: [{ id: 'high', label: '高分', condition: '' }, { id: 'rest', label: '默认', isDefault: true }] },
    { value: [{ id: 'high', label: '高分', condition: 'true' }, { id: 'high', label: '重复', isDefault: true }] },
    { value: '错误配置' }
  ])('拒绝没有唯一默认出口、重复 ID 或无效条件的配置 %#', ({ value }) => {
    expect(validateWorkflowGraph(multiBranch(value))).toContainEqual(expect.objectContaining({ code: 'BRANCH_CONFIG', nodeId: 'b' }))
  })
  it('每个分支 ID 必须恰好连接一个出口，并拒绝额外出口', () => {
    const graph = multiBranch(branches())
    graph.edges.push({ ...edge('extra', 'b', 'd'), branchId: 'high' })
    expect(validateWorkflowGraph(graph)).toContainEqual(expect.objectContaining({ code: 'BRANCH_OUTPUTS' }))
    graph.edges.pop()
    graph.edges[2] = { ...edge('bd', 'b', 'd'), branchId: 'unknown' }
    expect(validateWorkflowGraph(graph)).toContainEqual(expect.objectContaining({ code: 'BRANCH_OUTPUTS' }))
  })
  it('允许互斥分支共享普通后续节点', () => {
    const graph = multiBranch(branches())
    graph.nodes = [...graph.nodes.filter(value => value.id !== 'a'), node('shared', 'http')]
    graph.edges[1] = { ...edge('ba', 'b', 'shared'), branchId: 'high' }
    graph.edges[2] = { ...edge('bd', 'b', 'shared'), branchId: 'rest' }
    graph.edges.push(edge('sd', 'shared', 'd'))
    expect(validateWorkflowGraph(graph)).toEqual([])
  })
  it.each(['start', 'http', 'python'])('普通 %s 节点不能隐式扇出', type => {
    const graph = { nodes: [node('s', 'start'), node('h', type), node('a', 'end'), node('b', 'end')], edges: [edge('sh', 's', 'h'), edge('ha', 'h', 'a'), edge('hb', 'h', 'b')] }
    expect(validateWorkflowGraph(graph)).toContainEqual(expect.objectContaining({ code: 'NODE_OUTPUTS', nodeId: 'h' }))
  })
  it('非结束节点必须有出口', () => {
    expect(validateWorkflowGraph({ nodes: [node('s', 'start'), node('h', 'http'), node('e', 'end')], edges: [edge('sh', 's', 'h')] })).toContainEqual(expect.objectContaining({ code: 'NODE_OUTPUTS', nodeId: 'h' }))
  })
  it('拒绝可达和不可达的图回路', () => {
    const graph = { nodes: [node('s', 'start'), node('a', 'http'), node('b', 'python'), node('e', 'end')], edges: [edge('sa', 's', 'a'), edge('ab', 'a', 'b'), edge('ba', 'b', 'a')] }
    expect(validateWorkflowGraph(graph)).toContainEqual(expect.objectContaining({ code: 'CYCLE' }))
    graph.edges.shift()
    graph.edges.push(edge('se', 's', 'e'))
    expect(validateWorkflowGraph(graph)).toContainEqual(expect.objectContaining({ code: 'CYCLE' }))
  })
  it.each(['loop', 'parallel'])('拒绝 %s 的缺失、重复或未知控制出口', type => {
    const graph = control(type)
    graph.edges.push(edge('wrong', 'c', 'done', 'unknown'))
    expect(validateWorkflowGraph(graph)).toContainEqual(expect.objectContaining({ code: type === 'loop' ? 'LOOP_OUTPUTS' : 'PARALLEL_OUTPUTS' }))
    graph.edges.pop()
    graph.edges[2] = edge('cb', 'c', 'b', type === 'loop' ? 'body' : 'fork-0')
    expect(validateWorkflowGraph(graph)).toContainEqual(expect.objectContaining({ code: type === 'loop' ? 'LOOP_OUTPUTS' : 'PARALLEL_OUTPUTS' }))
  })
  it.each(['loop', 'parallel'])('拒绝 %s 的独立区域共享节点', type => {
    const graph = control(type)
    graph.edges[4] = edge('bb', 'b', 'ae')
    expect(validateWorkflowGraph(graph)).toContainEqual(expect.objectContaining({ code: type === 'loop' ? 'LOOP_REGION_OVERLAP' : 'PARALLEL_REGION_OVERLAP' }))
  })
  it('拒绝并行 fork 串入 join 后续', () => {
    const graph = control('parallel')
    graph.edges[3] = edge('aa', 'a', 'done')
    expect(validateWorkflowGraph(graph)).toContainEqual(expect.objectContaining({ code: 'PARALLEL_REGION_OVERLAP' }))
  })
  it('拒绝外部路径进入循环体内部', () => {
    const graph = { nodes: [node('s', 'start'), node('branch', 'branch'), node('loop', 'loop'), node('body', 'http'), node('bodyEnd', 'end'), node('done', 'end')], edges: [edge('sb', 's', 'branch'), edge('bl', 'branch', 'loop', 'true'), edge('bb', 'branch', 'body', 'false'), edge('lb', 'loop', 'body', 'body'), edge('ln', 'loop', 'done', 'next'), edge('be', 'body', 'bodyEnd')] }
    expect(validateWorkflowGraph(graph)).toContainEqual(expect.objectContaining({ code: 'REGION_ENTRY', nodeId: 'loop' }))
  })
  it('支持嵌套循环、并行和可汇合的互斥分支', () => {
    const graph = { nodes: [node('s', 'start'), node('loop', 'loop'), node('p', 'parallel'), node('b', 'branch'), node('h', 'http'), node('a', 'end'), node('bEnd', 'end'), node('join', 'end'), node('done', 'end')], edges: [edge('sl', 's', 'loop'), edge('lp', 'loop', 'p', 'body'), edge('ld', 'loop', 'done', 'next'), edge('pb', 'p', 'b', 'fork-0'), edge('pa', 'p', 'a', 'fork-1'), edge('pj', 'p', 'join', 'join'), edge('bt', 'b', 'h', 'true'), edge('bf', 'b', 'h', 'false'), edge('he', 'h', 'bEnd')] }
    expect(validateWorkflowGraph(graph)).toEqual([])
  })
})
