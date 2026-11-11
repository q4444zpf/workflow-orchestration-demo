import { mount } from '@vue/test-utils'
import { it, expect } from 'vitest'
import ParameterValueEditor from '../src/components/parameters/ParameterValueEditor.vue'
import RunParametersDialog from '../src/components/parameters/RunParametersDialog.vue'
import WorkflowParametersDialog from '../src/components/parameters/WorkflowParametersDialog.vue'

it('递归对象数组通过表单填写，false与0不会丢失', async () => {
  const schema = { type: 'object' as const, properties: [
    { name: 'users', type: 'array' as const, items: { type: 'object' as const, properties: [{ name: 'score', type: 'number' as const }] } },
    { name: 'enabled', type: 'boolean' as const }
  ] }
  const wrapper = mount(ParameterValueEditor, { props: { schema, value: { users: [{ score: 12 }], enabled: true }, path: 'input' } })
  await wrapper.get('[aria-label="input.users.0.score"]').setValue('0')
  expect(wrapper.emitted('update:value')?.at(-1)?.[0]).toEqual({ users: [{ score: 0 }], enabled: true })
  await wrapper.get('[aria-label="input.enabled"]').setValue('false')
  expect(wrapper.emitted('update:value')?.at(-1)?.[0]).toEqual({ users: [{ score: 12 }], enabled: false })
})
it('运行表单显示必填错误，默认值与对象数组按类型提交，取消不提交', async () => {
  const wrapper = mount(RunParametersDialog, { props: { definitions: [
    { name: 'score', type: 'number', required: true },
    { name: 'enabled', type: 'boolean', default: false },
    { name: 'users', type: 'array', default: [{ name: '张三' }], items: { type: 'object', properties: [{ name: 'name', type: 'string', required: true }] } }
  ] } })
  await wrapper.get('form').trigger('submit')
  expect(wrapper.find('[role="alert"]').text()).toContain('score')
  expect(wrapper.emitted('submit')).toBeUndefined()
  await wrapper.get('[aria-label="score"]').setValue('0')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({ score: 0, enabled: false, users: [{ name: '张三' }] })
  expect(wrapper.find('textarea').exists()).toBe(false)
  await wrapper.get('button[aria-label="取消运行"]').trigger('click')
  expect(wrapper.emitted('cancel')).toHaveLength(1)
})
it('参数结构通过界面定义布尔默认值，取消不修改原定义', async () => {
  const original: [] = []
  const wrapper = mount(WorkflowParametersDialog, { props: { modelValue: original } })
  await wrapper.get('button[aria-label="添加参数"]').trigger('click')
  await wrapper.get('[aria-label="参数名称"]').setValue('enabled')
  await wrapper.get('[aria-label="参数类型"]').setValue('boolean')
  await wrapper.get('[aria-label="设置默认值"]').setValue(true)
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual([{ name: 'enabled', type: 'boolean', default: false }])
  expect(original).toEqual([])
  wrapper.unmount()
})
