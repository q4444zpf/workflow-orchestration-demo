import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import PropertyPanel from '../src/components/PropertyPanel.vue'
vi.mock('monaco-editor', () => ({ editor: { create: vi.fn() } }))
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: class {} }))
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn(), success: vi.fn() }, ElMessageBox: { confirm: vi.fn().mockResolvedValue('confirm') } }))

it('开始节点通过可视化表格选择运行参数，切换全量输出不再填写JSON', async () => {
  const start = { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} }
  const wrapper = mount(PropertyPanel, { props: { node: start, apis: [], workflow: { name: '参数表单', nodes: [start], edges: [], variables: [{ name: 'score', type: 'number' }] } }, global: { stubs: {
    'el-form': { template: '<form><slot /></form>' }, 'el-form-item': { template: '<div><slot /></div>' }, 'el-input': true, 'el-select': true, 'el-option': true
  } } })
  await flushPromises()
  await wrapper.get('select[aria-label="开始输出模式"]').setValue('fields')
  await wrapper.get('button[aria-label="添加映射字段"]').trigger('click')
  await flushPromises()
  expect(wrapper.emitted('update:node')?.at(-1)?.[0]).toMatchObject({ data: { inputMapping: { param1: 'var.score' } } })
  expect(wrapper.find('textarea').exists()).toBe(false)
  await wrapper.get('select[aria-label="开始输出模式"]').setValue('all')
  expect(wrapper.emitted('update:node')?.at(-1)?.[0]).toMatchObject({ data: { inputMapping: {} } })
  wrapper.unmount()
})

it('只读显示当前节点ID，切换后复制新ID且不修改节点', async () => {
  let clipboard = ''
  vi.stubGlobal('navigator', { clipboard: { writeText: async (value: string) => { clipboard = value } } })
  const wrapper = mount(PropertyPanel, { props: {
    node: { id: 'actual-node-123', type: 'end', position: { x: 0, y: 0 }, data: { label: '显示名称' } }, apis: []
  }, global: { stubs: ['el-form', 'el-form-item', 'el-input', 'el-select', 'el-option'] } })
  try {
    await flushPromises()
    expect(wrapper.get('input[aria-label="节点 ID"]').element).toHaveProperty('value', 'actual-node-123')
    expect(wrapper.get('input[aria-label="节点 ID"]').attributes('readonly')).toBeDefined()
    await wrapper.setProps({ node: { id: 'another-node-456', type: 'end', position: { x: 0, y: 0 }, data: { label: '显示名称' } } })
    await flushPromises()
    expect(wrapper.get('input[aria-label="节点 ID"]').element).toHaveProperty('value', 'another-node-456')
    await wrapper.get('button[aria-label="复制节点 ID"]').trigger('click')
    await flushPromises()
    expect(clipboard).toBe('another-node-456')
    expect(wrapper.emitted('update:node')).toBeUndefined()
    await wrapper.setProps({ node: null })
    expect(wrapper.find('input[aria-label="节点 ID"]').exists()).toBe(false)
  } finally { wrapper.unmount(); vi.unstubAllGlobals() }
})

it('旧分支可转换并按稳定标识编辑、排序，默认出口始终只有一个', async () => {
  const original = { id: 'branch', type: 'branch', position: { x: 0, y: 0 }, data: { condition: 'var.score >= 80' } }
  const wrapper = mount(PropertyPanel, { props: { node: original, apis: [] }, global: { stubs: {
    'el-form': { template: '<form><slot /></form>' }, 'el-form-item': { template: '<div><slot /></div>' }, 'el-input': true, 'el-select': true, 'el-option': true
  } } })
  await flushPromises()
  expect(wrapper.emitted('update:node')).toBeUndefined()
  expect(wrapper.findAll('[data-branch-id]')).toHaveLength(2)
  await wrapper.get('[data-branch-id="true"] input[aria-label="分支名称"]').setValue('高分')
  await wrapper.get('button[aria-label="新增条件分支"]').trigger('click')
  await flushPromises()
  const rows = wrapper.findAll('[data-branch-id]')
  expect(rows).toHaveLength(3)
  const addedId = rows[1].attributes('data-branch-id')
  await rows[1].get('input[aria-label="条件表达式"]').setValue('var.score >= 60')
  await rows[1].get('button[aria-label="上移分支"]').trigger('click')
  await wrapper.get(`[data-branch-id="${addedId}"] input[aria-label="默认出口"]`).setValue(true)
  await flushPromises()
  const updated = wrapper.emitted('update:node')?.at(-1)?.[0] as { data: { branches: Array<{id:string;label:string;condition?:string;isDefault?:boolean}> } }
  expect(updated.data.branches.map(branch => branch.id)).toEqual([addedId, 'true', 'false'])
  expect(updated.data.branches.find(branch => branch.id === 'true')?.label).toBe('高分')
  expect(updated.data.branches.filter(branch => branch.isDefault).map(branch => branch.id)).toEqual([addedId])
  expect(original.data).toEqual({ condition: 'var.score >= 80' })
  wrapper.unmount()
})

it('写接口只有声明外部支持幂等后才能增加自动重试，取消声明恢复一次尝试', async () => {
  const wrapper = mount(PropertyPanel, { props: { node: { id: 'http', type: 'http', position: { x: 0, y: 0 }, data: { method: 'POST', url: 'http://localhost/create' } }, apis: [] }, global: { stubs: {
    'el-form': { template: '<form><slot /></form>' }, 'el-form-item': { template: '<div><slot /></div>' }, 'el-input': true, 'el-select': true, 'el-option': true
  } } })
  await flushPromises()
  expect(wrapper.get('input[aria-label="最大尝试次数"]').attributes('max')).toBe('1')
  await wrapper.get('input[aria-label="外部接口支持幂等"]').setValue(true)
  await wrapper.get('input[aria-label="最大尝试次数"]').setValue(3)
  await flushPromises()
  expect(wrapper.emitted('update:node')?.at(-1)?.[0]).toMatchObject({ data: { idempotent: true, retry: { maxAttempts: 3 } } })
  await wrapper.get('input[aria-label="外部接口支持幂等"]').setValue(false)
  await flushPromises()
  expect(wrapper.emitted('update:node')?.at(-1)?.[0]).toMatchObject({ data: { idempotent: false, retry: { maxAttempts: 1 } } })
  wrapper.unmount()
})

it('删除分支需要确认，取消时保留分支，确认删除默认分支后仍保留一个默认出口', async () => {
  const { ElMessageBox } = await import('element-plus')
  vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
  const wrapper = mount(PropertyPanel, { props: { node: { id: 'b', type: 'branch', position: { x: 0, y: 0 }, data: { condition: 'true' } }, apis: [] }, global: { stubs: {
    'el-form': { template: '<form><slot /></form>' }, 'el-form-item': { template: '<div><slot /></div>' }, 'el-input': true, 'el-select': true, 'el-option': true
  } } })
  await flushPromises()
  await wrapper.get('[data-branch-id="false"] button[aria-label="删除分支"]').trigger('click')
  await flushPromises()
  expect(wrapper.findAll('[data-branch-id]')).toHaveLength(2)
  await wrapper.get('[data-branch-id="false"] button[aria-label="删除分支"]').trigger('click')
  await flushPromises()
  expect(wrapper.findAll('[data-branch-id]')).toHaveLength(1)
  expect(wrapper.get('input[aria-label="默认出口"]').element).toHaveProperty('checked', true)
  expect(wrapper.get('button[aria-label="删除分支"]').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})
it('删除按钮发送当前节点编号；未选节点时不显示', async () => {
  const wrapper = mount(PropertyPanel, { props: {
    node: { id: 'end', type: 'end', position: { x: 0, y: 0 }, data: { label: '结束' } }, apis: []
  }, global: { stubs: ['el-form', 'el-form-item', 'el-input', 'el-select', 'el-option'] } })
  await flushPromises()
  await wrapper.get('button[aria-label="删除节点"]').trigger('click')
  expect(wrapper.emitted('delete-node')?.[0]).toEqual(['end'])
  await wrapper.setProps({ node: null })
  expect(wrapper.find('button[aria-label="删除节点"]').exists()).toBe(false)
  wrapper.unmount()
})
it('切换节点不会修改节点数据或把流程标记为未保存', async () => {
  const wrapper = mount(PropertyPanel, { props: {
    node: { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: '开始', inputMapping: { userId: 'var.userId' } } }, apis: []
  }, global: { stubs: ['el-form', 'el-form-item', 'el-input', 'el-select', 'el-option'] } })
  await flushPromises()
  await wrapper.setProps({ node: { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: { label: '结束' } } })
  await flushPromises()
  expect(wrapper.emitted('update:node')).toBeUndefined()
  wrapper.unmount()
})

it('旧HTTP请求体无法无损转换时不自动改写，明确切换后才生成新表单', async () => {
  const original = { id: 'http', type: 'http', position: { x: 0, y: 0 }, data: { method: 'POST', body: '原有无法解析的请求体', url: 'https://example.test' } }
  const wrapper = mount(PropertyPanel, { props: {
    node: original, apis: []
  }, global: { stubs: {
    'el-form': { template: '<form><slot /></form>' },
    'el-form-item': { props: ['label'], template: '<label :data-field="label"><slot /></label>' },
    'el-input': { props: ['modelValue'], emits: ['update:modelValue'], template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
    'el-select': true, 'el-option': true
  } } })
  await flushPromises()
  expect(wrapper.emitted('update:node')).toBeUndefined()
  expect(wrapper.text()).toContain('原请求体暂不能无损转换')
  await wrapper.findAll('button').find(button => button.text() === '改用可视化请求体')!.trigger('click')
  await flushPromises()
  expect(wrapper.emitted('update:node')?.at(-1)?.[0]).toMatchObject({ data: { requestBody: { kind: 'object', fields: {} } } })
  expect(original.data.body).toBe('原有无法解析的请求体')
  wrapper.unmount()
})
