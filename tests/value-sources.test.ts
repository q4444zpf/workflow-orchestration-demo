import { it, expect } from 'vitest'
import { availableSources, parseSource, serializeSource, invalidReferenceIssues, outputSchema } from '../src/components/parameters/valueSources'
const node = (id: string, type: string) => ({ id, type, position: { x: 0, y: 0 }, data: { label: '同名节点' } })
it('上游来源按稳定ID保存，只有各路径都可用的结果出现在汇合处', () => {
  const workflow = { name: '分支', variables: [{ name: 'score', type: 'number' as const }], nodes: [node('s', 'start'), node('b', 'branch'), node('p-uuid', 'python'), node('q-uuid', 'python'), node('e', 'end')], edges: [
    { id: '1', source: 's', target: 'b' }, { id: '2', source: 'b', target: 'p-uuid' }, { id: '3', source: 'b', target: 'q-uuid' },
    { id: '4', source: 'p-uuid', target: 'e' }, { id: '5', source: 'q-uuid', target: 'e' }
  ] }
  expect(availableSources(workflow, 'e').filter(source => source.kind === 'node').map(source => source.path)).toEqual(['ctx.s.output', 'ctx.b.output'])
  expect(parseSource('ctx.p-uuid.output.result')).toEqual({ kind: 'node', id: 'p-uuid', field: 'result' })
  expect(serializeSource({ kind: 'node', id: 'p-uuid', field: 'result.score' })).toBe('ctx.p-uuid.output.result.score')
})
it('循环和并行子流程不向后续泄漏，循环体可以选择当前元素', () => {
  const workflow = { name: '循环', nodes: [node('s', 'start'), node('loop', 'loop'), node('body', 'end'), node('next', 'end')], edges: [
    { id: '1', source: 's', target: 'loop' }, { id: '2', source: 'loop', target: 'body', label: 'body' }, { id: '3', source: 'loop', target: 'next', label: 'next' }
  ] }
  expect(availableSources(workflow, 'next').filter(source => source.kind === 'node').map(source => source.path)).toEqual(['ctx.s.output', 'ctx.loop.output'])
  expect(availableSources(workflow, 'body').some(source => source.path === 'var.item')).toBe(true)
  const parallel = { ...workflow, nodes: [node('s', 'start'), node('p', 'parallel'), node('a', 'end'), node('b', 'end'), node('join', 'end')], edges: [
    { id: '1', source: 's', target: 'p' }, { id: '2', source: 'p', target: 'a', label: 'fork-0' }, { id: '3', source: 'p', target: 'b', label: 'fork-1' }, { id: '4', source: 'p', target: 'join', label: 'join' }
  ] }
  expect(availableSources(parallel, 'join').filter(source => source.kind === 'node').map(source => source.path)).toEqual(['ctx.s.output', 'ctx.p.output'])
  expect(availableSources(parallel, 'a').filter(source => source.kind === 'node').map(source => source.path)).toEqual(['ctx.s.output'])
})
it('可以选择整份工作流参数，不需手写var路径', () => {
  const sources = availableSources({ name: '参数', nodes: [node('s', 'start')], edges: [], variables: [{ name: 'score', type: 'number' }] }, 's')
  expect(sources.some(source => source.path === 'var' && source.kind === 'workflow')).toBe(true)
  expect(serializeSource({ kind: 'workflow', id: '', field: '' })).toBe('var')
})
it('删除参数、上游节点或已声明输出字段后，保留原引用并阻止运行', () => {
  const end = { ...node('e', 'end'), data: { resultMapping: { score: 'var.deleted', user: 'ctx.deleted.output', missing: 'ctx.s.output.removed' } } }
  const workflow = { name: '失效引用', nodes: [node('s', 'start'), end], variables: [{ name: 'score', type: 'number' as const }], edges: [{ id: 'se', source: 's', target: 'e' }] }
  expect(invalidReferenceIssues(workflow)).toHaveLength(3)
  expect(end.data.resultMapping.user).toBe('ctx.deleted.output')
})
it('循环体中的循环节点输出代表当前元素，字段结构不能误用循环汇总数组', () => {
  const workflow = { name: '对象循环', variables: [{ name: 'users', type: 'array' as const, items: { type: 'object' as const, properties: [{ name: 'score', type: 'number' as const }] } }], nodes: [node('s', 'start'), { ...node('loop', 'loop'), data: { iteratorExpression: 'var.users' } }, { ...node('body', 'end'), data: { resultExpression: 'ctx.loop.output.score' } }, node('next', 'end')], edges: [
    { id: '1', source: 's', target: 'loop' }, { id: '2', source: 'loop', target: 'body', label: 'body' }, { id: '3', source: 'loop', target: 'next', label: 'next' }
  ] }
  expect(invalidReferenceIssues(workflow)).toEqual([])
  expect(availableSources(workflow, 'body').find(source => source.path === 'var.item')?.schema?.type).toBe('object')
})
it.each(['var.user.profile', 'var.users.0.profile'])('开始映射子对象按完整路径推断结构，合法下游不会误报：%s', path => {
  const profile = { name: 'profile', type: 'object' as const, properties: [{ name: 'score', type: 'number' as const }] }
  const start = { ...node('s', 'start'), data: { inputMapping: { person: path, all: 'var' } } }
  const workflow = { name: '投影结构', variables: [{ name: 'user', type: 'object' as const, properties: [profile] }, { name: 'users', type: 'array' as const, items: { type: 'object' as const, properties: [profile] } }], nodes: [start, { ...node('e', 'end'), data: { resultMapping: { score: 'ctx.s.output.person.score', user: 'ctx.s.output.all.user' } } }], edges: [{ id: 'se', source: 's', target: 'e' }] }
  expect(outputSchema(start, workflow)?.properties?.find(field => field.name === 'person')?.properties?.map(field => field.name)).toEqual(['score'])
  expect(invalidReferenceIssues(workflow)).toEqual([])
})
