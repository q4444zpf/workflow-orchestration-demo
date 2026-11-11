<script setup lang="ts">
import { type WorkflowVariable, type ValueSchema, emptyValue } from '../../../server/src/shared/parameterSchema'
import SchemaShapeEditor from './SchemaShapeEditor.vue'
import ParameterValueEditor from './ParameterValueEditor.vue'
const props = withDefaults(defineProps<{ modelValue: WorkflowVariable[]; depth?: number }>(), { depth: 0 })
const emit = defineEmits<{ 'update:modelValue': [fields: WorkflowVariable[]] }>()
function update(index: number, patch: Partial<WorkflowVariable>) { emit('update:modelValue', props.modelValue.map((field, i) => i === index ? { ...field, ...patch } : field)) }
function shape(index: number, schema: ValueSchema) {
  const current = props.modelValue[index]
  const { properties: _properties, items: _items, ...rest } = current
  emit('update:modelValue', props.modelValue.map((field, i) => i === index ? { ...rest, ...schema, ...(current.default !== undefined && current.type !== schema.type ? { default: emptyValue(schema) } : {}) } : field))
}
function text(event: Event): string { return event.target instanceof HTMLInputElement ? event.target.value : '' }
function checked(event: Event): boolean { return event.target instanceof HTMLInputElement && event.target.checked }
</script>
<template>
  <div class="schema-fields">
    <div v-for="(field, index) in modelValue" :key="index" class="schema-field" :data-parameter-row="index">
      <div class="schema-row"><input :value="field.name" aria-label="参数名称" placeholder="参数名称" @input="update(index, { name: text($event) })" /><label class="required"><input type="checkbox" :checked="field.required" aria-label="参数必填" @change="update(index, { required: checked($event) })" />必填</label><button type="button" aria-label="删除参数" @click="emit('update:modelValue', modelValue.filter((_, i) => i !== index))">删除</button></div>
      <SchemaShapeEditor :model-value="field" :depth="depth" @update:model-value="shape(index, $event)" />
      <input class="description" :value="field.description || ''" aria-label="参数说明" placeholder="参数说明（可选）" @input="update(index, { description: text($event) })" />
      <label class="default-toggle"><input type="checkbox" :checked="field.default !== undefined" aria-label="设置默认值" @change="update(index, { default: checked($event) ? emptyValue(field) : undefined })" />设置默认值</label>
      <ParameterValueEditor v-if="field.default !== undefined" :schema="field" :value="field.default" :path="`${field.name || '新参数'}.默认值`" @update:value="update(index, { default: $event })" />
    </div>
    <p v-if="!modelValue.length" class="empty">尚未定义字段</p>
    <button type="button" class="add-field" aria-label="添加参数" @click="emit('update:modelValue', [...modelValue, { name: '', type: 'string' }])">＋ 添加参数</button>
  </div>
</template>
<style scoped>
.schema-fields { display: grid; gap: 12px; }.schema-field { padding: 14px; background: #f9fbfe; border: 1px solid #e1e6ef; border-radius: 7px; display: grid; gap: 9px; }.schema-row { display: flex; align-items: center; gap: 10px; }.schema-row > input { flex: 1; min-width: 0; }input:not([type=checkbox]) { padding: 7px 9px; width: 100%; border: 1px solid #dce3ec; border-radius: 5px; font-size: 13px; color: #344158; }.required { white-space: nowrap; font-size: 12px; color: #617088; }.default-toggle { display: flex; gap: 6px; align-items: center; font-size: 12px; color: #617088; }button { flex-shrink: 0; border: 1px solid #dce3ec; border-radius: 4px; padding: 6px 10px; color: #1677ff; background: white; font-size: 12px; }.schema-row button { color: #b34e59; }.empty { color: #8490a3; margin: 0; font-size: 12px; }.add-field { justify-self: start; }
</style>
