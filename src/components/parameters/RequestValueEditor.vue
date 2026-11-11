<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { RequestValue } from '../../../server/src/shared/requestValues'
import { inferValueSchema, emptyValue, type ParameterType } from '../../../server/src/shared/parameterSchema'
import type { Workflow } from '../../types'
import ParameterValueEditor from './ParameterValueEditor.vue'
import ValueSourcePicker from './ValueSourcePicker.vue'
const props = defineProps<{ modelValue: RequestValue; workflow: Workflow; nodeId: string; path: string; objectOnly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [binding: RequestValue] }>()
const error = shallowRef('')
const literalType = computed(() => props.modelValue.kind === 'literal' ? props.modelValue.value === null ? 'null' : inferValueSchema(props.modelValue.value).type : 'string')
function kind(event: Event) {
  if (!(event.target instanceof HTMLSelectElement)) return
  const value = event.target.value
  emit('update:modelValue', value === 'object' ? { kind: 'object', fields: {} } : value === 'array' ? { kind: 'array', items: [] } : value === 'reference' ? { kind: 'reference', path: '' } : { kind: 'literal', value: '' })
}
function type(event: Event) { if (event.target instanceof HTMLSelectElement) emit('update:modelValue', { kind: 'literal', value: event.target.value === 'null' ? null : emptyValue({ type: event.target.value as ParameterType }) }) }
function add() { if (props.modelValue.kind !== 'object') return; const fields = props.modelValue.fields; let index = 1; while (Object.prototype.hasOwnProperty.call(fields, `field${index}`)) index++; emit('update:modelValue', { kind: 'object', fields: { ...fields, [`field${index}`]: { kind: 'literal', value: '' } } }) }
function field(name: string, binding: RequestValue) { if (props.modelValue.kind === 'object') emit('update:modelValue', { kind: 'object', fields: { ...props.modelValue.fields, [name]: binding } }) }
function rename(name: string, event: Event) {
  if (!(event.target instanceof HTMLInputElement) || props.modelValue.kind !== 'object') return
  if (!Object.prototype.hasOwnProperty.call(props.modelValue.fields, name)) return
  const next = event.target.value.trim()
  if (!next || ['__proto__', 'constructor', 'prototype'].includes(next) || next !== name && Object.prototype.hasOwnProperty.call(props.modelValue.fields, next)) { error.value = '字段名须非空且唯一'; event.target.value = name; return }
  error.value = ''; emit('update:modelValue', { kind: 'object', fields: Object.fromEntries(Object.entries(props.modelValue.fields).map(([key, binding]) => [key === name ? next : key, binding])) })
}
function remove(name: string) { if (props.modelValue.kind === 'object') emit('update:modelValue', { kind: 'object', fields: Object.fromEntries(Object.entries(props.modelValue.fields).filter(([key]) => key !== name)) }) }
function item(index: number, binding: RequestValue) { if (props.modelValue.kind === 'array') emit('update:modelValue', { kind: 'array', items: props.modelValue.items.map((value, i) => i === index ? binding : value) }) }
</script>
<template>
  <div class="request-value">
    <select v-if="!objectOnly" :aria-label="`${path} 值来源`" :value="modelValue.kind" @change="kind"><option value="literal">固定值</option><option value="reference">引用参数或节点输出</option><option value="object">对象字段</option><option value="array">数组项目</option><option v-if="modelValue.kind === 'template'" value="template">原文本模板（保留）</option></select>
    <ValueSourcePicker v-if="modelValue.kind === 'reference'" :model-value="modelValue.path" :workflow="workflow" :node-id="nodeId" @update:model-value="emit('update:modelValue', { kind: 'reference', path: $event })" />
    <template v-else-if="modelValue.kind === 'literal'"><select :aria-label="`${path} 固定值类型`" :value="literalType" @change="type"><option value="string">文本</option><option value="number">数字</option><option value="boolean">布尔</option><option value="null">空值</option><option v-if="literalType === 'object'" value="object">原对象值</option><option v-if="literalType === 'array'" value="array">原数组值</option></select><span v-if="modelValue.value === null" class="hint">空值（null）</span><ParameterValueEditor v-else :schema="inferValueSchema(modelValue.value)" :value="modelValue.value" :path="path" @update:value="emit('update:modelValue', { kind: 'literal', value: $event === undefined ? null : $event })" /></template>
    <input v-else-if="modelValue.kind === 'template'" :aria-label="`${path} 原文本模板`" :value="modelValue.value" @input="emit('update:modelValue', { kind: 'template', value: ($event.target as HTMLInputElement).value })" />
    <div v-else-if="modelValue.kind === 'object'" class="request-fields">
      <div v-for="(binding, name) in modelValue.fields" :key="name" class="request-field"><div class="name-row"><input :aria-label="`${path} 字段名称`" :value="name" @change="rename(String(name), $event)" @blur="rename(String(name), $event)" /><button type="button" :aria-label="`删除 ${path}.${name}`" @click="remove(String(name))">删除</button></div><RequestValueEditor :model-value="binding" :workflow="workflow" :node-id="nodeId" :path="`${path}.${name}`" @update:model-value="field(String(name), $event)" /></div>
      <button type="button" :aria-label="`${path} 添加字段`" @click="add">＋ 添加字段</button>
    </div>
    <div v-else class="request-fields"><div v-for="(binding, index) in modelValue.items" :key="index" class="request-field"><div class="name-row"><span>第 {{ index + 1 }} 项</span><button type="button" @click="emit('update:modelValue', { kind: 'array', items: modelValue.items.filter((_, i) => i !== index) })">删除</button></div><RequestValueEditor :model-value="binding" :workflow="workflow" :node-id="nodeId" :path="`${path}.${index}`" @update:model-value="item(index, $event)" /></div><button type="button" @click="emit('update:modelValue', { kind: 'array', items: [...modelValue.items, { kind: 'literal', value: '' }] })">＋ 添加项目</button></div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
  </div>
</template>
<style scoped>
.request-value { display: grid; gap: 7px; }input, select { width: 100%; min-width: 0; padding: 7px 8px; border: 1px solid #dce3ec; border-radius: 4px; background: white; color: #344158; font-size: 12px; }.request-fields { display: grid; gap: 8px; }.request-field { border: 1px solid #e1e6ef; border-radius: 5px; background: #f9fbfe; padding: 10px; }.name-row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }.name-row input { flex: 1; width: 0; }.name-row button { border: 0; color: #ac5362; }.name-row span { flex: 1; font-size: 12px; }button { padding: 5px 8px; border: 1px solid #dce3ec; border-radius: 4px; background: white; color: #1677ff; font-size: 12px; }.hint { color: #8490a3; font-size: 12px; }.error { color: #bd4545; font-size: 12px; margin: 0; }
</style>
