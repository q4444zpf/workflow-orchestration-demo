import { mount, flushPromises } from '@vue/test-utils'
import { it, expect, vi } from 'vitest'
import { useVueFlow, VueFlow } from '@vue-flow/core'
import { defineComponent, ref } from 'vue'
import FlowCanvas from '../src/components/FlowCanvas.vue'

it('少量节点自动适应和手动适应最多100%，仍允许用户主动放大', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('vue-flow__node') ? 116 : 800 })
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('vue-flow__node') ? 48 : 600 })
  const wrapper = mount(FlowCanvas, { props: { nodes: [], edges: [] } })
  try {
    await flushPromises()
    await wrapper.setProps({ nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} }] })
    const flow = useVueFlow(wrapper.findComponent(VueFlow).vm.id)
    const node = flow.findNode('s')!
    node.dimensions = { width: 116, height: 48 }
    flow.emits.nodesInitialized([node])
    await new Promise(resolve => setTimeout(resolve, 220)); await flushPromises()
    expect(flow.viewport.value.zoom).toBeLessThanOrEqual(1)
    await wrapper.get('[aria-label="适应画布"]').trigger('click'); await flushPromises()
    expect(flow.viewport.value.zoom).toBeLessThanOrEqual(1)
    await wrapper.get('[aria-label="放大画布"]').trigger('click'); await flushPromises()
    expect(flow.viewport.value.zoom).toBeGreaterThan(1)
  } finally { wrapper.unmount(); width.mockRestore(); height.mockRestore(); vi.unstubAllGlobals() }
})

it('父级替换节点配置后同步画布出口名称、顺序和增删，不保留旧节点数据', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1 })
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const exit = this.closest<HTMLElement>('.branch-exit')
    return new DOMRect(0, exit ? parseFloat(exit.style.top) : 0, 800, 600)
  })
  const nodes = ref([{ id: 'branch', type: 'branch', position: { x: 0, y: 0 }, data: { branches: [
    { id: 'pass', label: '及格', condition: 'true' }, { id: 'other', label: '其余', isDefault: true }
  ] } }])
  const wrapper = mount(defineComponent({ components: { FlowCanvas }, setup: () => ({ nodes, edges: ref([]) }), template: '<FlowCanvas v-model:nodes="nodes" v-model:edges="edges" />' }))
  try {
    await flushPromises()
    expect(wrapper.findAll('.branch-exit span').map(exit => exit.text())).toEqual(['及格', '其余（默认）'])
    const flow = useVueFlow(wrapper.findComponent(VueFlow).vm.id)
    flow.updateNodeInternals(['branch'])
    await flushPromises()
    nodes.value[0] = { ...nodes.value[0], data: { branches: [
      { id: 'other', label: '其余', isDefault: true }, { id: 'pass', label: '达到及格线', condition: 'true' }
    ] } }
    await flushPromises()
    expect(wrapper.findAll('.branch-exit span').map(exit => exit.text())).toEqual(['其余（默认）', '达到及格线'])
    expect(wrapper.findAll('.branch-exit [data-handleid]').map(handle => handle.attributes('data-handleid'))).toEqual(['other', 'pass'])
    const handles = flow.findNode('branch')!.handleBounds.source!
    expect(handles.find(handle => handle.id === 'pass')!.y).toBeGreaterThan(handles.find(handle => handle.id === 'other')!.y)
    const updated = [{ ...nodes.value[0], data: { branches: [
      { id: 'pass', label: '新默认', isDefault: true }, { id: 'high', label: '优秀', condition: 'true' }
    ] } }]
    nodes.value = updated
    await flushPromises()
    expect(wrapper.findAll('.branch-exit span').map(exit => exit.text())).toEqual(['新默认（默认）', '优秀'])
    expect(wrapper.findAll('.branch-exit [data-handleid]').map(handle => handle.attributes('data-handleid'))).toEqual(['pass', 'high'])
  } finally { wrapper.unmount(); width.mockRestore(); height.mockRestore(); bounds.mockRestore(); vi.unstubAllGlobals() }
})

it.each(['Delete', 'Backspace'])('%s 只请求确认删除，编辑输入框时不触发请求', async key => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
  const wrapper = mount(FlowCanvas, { attachTo: document.body, props: {
    nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
      { id: 'end', type: 'end', selected: true, position: { x: 100, y: 0 }, data: {} }
    ], edges: [{ id: 'edge', source: 'start', target: 'end' }]
  } })
  try {
    await flushPromises()
    const flow = useVueFlow(wrapper.findComponent(VueFlow).vm.id)
    const input = document.createElement('textarea')
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }))
    await flushPromises()
    expect(flow.nodes.value).toHaveLength(2)
    expect(wrapper.emitted('delete-nodes')).toBeUndefined()
    input.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }))
    input.remove()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('delete-nodes')?.[0]).toEqual([['end']])
    expect(flow.nodes.value).toHaveLength(2)
    expect(flow.edges.value).toHaveLength(1)
  } finally {
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }))
    wrapper.unmount()
    width.mockRestore(); height.mockRestore(); vi.unstubAllGlobals()
  }
})

it('连接两个节点后将新边同步给父组件', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
  const nodes = [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: {} }
  ]
  const wrapper = mount(FlowCanvas, { props: { nodes, edges: [] } })
  await flushPromises()
  const flow = useVueFlow(wrapper.findComponent(VueFlow).vm.id)
  flow.emits.connect({ source: 'start', target: 'end', sourceHandle: null, targetHandle: null })
  await flushPromises()
  expect(flow.edges.value).toEqual([expect.objectContaining({ source: 'start', target: 'end' })])
  expect(wrapper.emitted('update:edges')?.at(-1)?.[0]).toEqual([expect.objectContaining({ source: 'start', target: 'end' })])
  wrapper.unmount()
  width.mockRestore()
  height.mockRestore()
  vi.unstubAllGlobals()
})

it('分支出口连线携带稳定标识和显示名称，旧连线加载后定位到对应出口', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
  const wrapper = mount(FlowCanvas, { props: { nodes: [
    { id: 'b', type: 'branch', position: { x: 0, y: 0 }, data: { branches: [
      { id: 'high', label: '高分', condition: 'true' }, { id: 'otherwise', label: '默认', isDefault: true }
    ] } }, { id: 'end', type: 'end', position: { x: 200, y: 0 }, data: {} }
  ], edges: [] } })
  try {
    await flushPromises()
    const flow = useVueFlow(wrapper.findComponent(VueFlow).vm.id)
    expect(wrapper.find('[data-handleid="high"]').exists()).toBe(true)
    flow.emits.connect({ source: 'b', target: 'end', sourceHandle: 'high', targetHandle: null })
    await flushPromises()
    expect(wrapper.emitted('update:edges')?.at(-1)?.[0]).toEqual([expect.objectContaining({ branchId: 'high', sourceHandle: 'high', label: '高分' })])
    flow.emits.connect({ source: 'b', target: 'end', sourceHandle: 'otherwise', targetHandle: null })
    await flushPromises()
    await wrapper.setProps({ execution: { id: 3, workflow_id: 1, status: 'success', logs: [], result: null, context: {
      b: { status: 'success', input: {}, output: { branchId: 'high', label: '高分' } }, end: { status: 'success', input: {}, output: null }
    } } })
    await flushPromises()
    expect(flow.edges.value.find(edge => edge.sourceHandle === 'high')?.class).toContain('run-edge-success')
    expect(flow.edges.value.find(edge => edge.sourceHandle === 'otherwise')?.class).toContain('run-edge-idle')
  } finally { wrapper.unmount(); width.mockRestore(); height.mockRestore(); vi.unstubAllGlobals() }
})
