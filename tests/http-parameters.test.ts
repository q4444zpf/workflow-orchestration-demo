import { mount, flushPromises } from '@vue/test-utils'
import { expect, it } from 'vitest'
import RequestValueEditor from '../src/components/parameters/RequestValueEditor.vue'
import HttpParametersEditor from '../src/components/parameters/HttpParametersEditor.vue'
import { isRequestValue } from '../server/src/shared/requestValues'
const workflow = { name: 'HTTP', variables: [{ name: 'score', type: 'number' as const }], nodes: [
  { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} }, { id: 'h', type: 'http', position: { x: 1, y: 0 }, data: {} }
], edges: [{ id: 'sh', source: 's', target: 'h' }] }
it('清空固定数字值后仍能无损保存为有效请求值，不产生缺字段协议', async () => {
  const wrapper = mount(RequestValueEditor, { props: { modelValue: { kind: 'literal', value: 2 }, workflow, nodeId: 'h', path: 'body' } })
  await wrapper.get('[aria-label="body"]').setValue('')
  const binding = wrapper.emitted('update:modelValue')?.at(-1)?.[0]
  expect(isRequestValue(JSON.parse(JSON.stringify(binding)))).toBe(true)
  expect(binding).toEqual({ kind: 'literal', value: null })
})
it('打开旧HTTP配置不改写，编辑时才转换模板字段且保持其他值类型', async () => {
  const value = { method: 'POST', body: '{"score":"{{var.score}}","enabled":false}', headers: { 'X-Score': '{{var.score}}' } }
  const wrapper = mount(HttpParametersEditor, { props: { modelValue: value, workflow, nodeId: 'h' } })
  await flushPromises()
  expect(wrapper.emitted('change')).toBeUndefined()
  await wrapper.get('[aria-label="请求体.score 原文本模板"]').setValue('prefix={{var.score}}')
  const change = wrapper.emitted('change')?.at(-1)?.[0]
  expect(change).toEqual({ body: undefined, requestBody: { kind: 'object', fields: { score: { kind: 'template', value: 'prefix={{var.score}}' }, enabled: { kind: 'literal', value: false } } } })
  expect(value.body).toBe('{"score":"{{var.score}}","enabled":false}')
})
