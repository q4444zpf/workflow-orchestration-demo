import { mount } from '@vue/test-utils'
import { it, expect } from 'vitest'
import InputMappingEditor from '../src/components/parameters/InputMappingEditor.vue'
import RequestValueEditor from '../src/components/parameters/RequestValueEditor.vue'
const workflow = { name: '输入', variables: [{ name: 'score', type: 'number' as const }], nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} }], edges: [] }
it('辅助输入工具仅触发失焦时也能提交映射字段名，不被后续来源更新覆盖', async () => {
  const wrapper = mount(InputMappingEditor, { props: { modelValue: { param1: 'var.score' }, workflow, nodeId: 's' } })
  const input = wrapper.get('[aria-label="目标参数名"]')
  Object.assign(input.element, { value: 'score' })
  await input.trigger('blur')
  expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual({ score: 'var.score' })
})
it('HTTP字段名在失焦时提交，保留字段中的typed binding', async () => {
  const wrapper = mount(RequestValueEditor, { props: { modelValue: { kind: 'object', fields: { field1: { kind: 'literal', value: 0 } } }, workflow, nodeId: 's', path: 'body' } })
  const input = wrapper.get('[aria-label="body 字段名称"]')
  Object.assign(input.element, { value: 'score' })
  await input.trigger('blur')
  expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual({ kind: 'object', fields: { score: { kind: 'literal', value: 0 } } })
})
