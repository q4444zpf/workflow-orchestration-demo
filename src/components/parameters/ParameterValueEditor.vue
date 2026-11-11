<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { type ValueSchema, isRecord, inferValueSchema, emptyValue, parameterTypeLabels, type ParameterType } from '../../../server/src/shared/parameterSchema'
const props = defineProps<{ schema: ValueSchema; value?: unknown; path: string }>()
const emit = defineEmits<{ 'update:value': [value: unknown] }>()
const objectValue = computed(() => isRecord(props.value) ? props.value : {})
const arrayValue = computed(() => Array.isArray(props.value) ? props.value : [])
const fields = computed(() => {
  const declared = props.schema.properties || []
  const extras = Object.entries(objectValue.value).filter(([name]) => !declared.some(field => field.name === name)).map(([name, value]) => ({ name, ...inferValueSchema(value) }))
  return [...declared, ...extras]
})
const newKey = shallowRef('')
const newType = shallowRef<ParameterType>('string')
const keyError = shallowRef('')
function setField(name: string, value: unknown) {
  const next = { ...objectValue.value }
  if (value === undefined) delete next[name]
  else Object.defineProperty(next, name, { value, enumerable: true, configurable: true, writable: true })
  emit('update:value', next)
}
function addField() {
  const name = newKey.value.trim()
  if (!name || name.includes('.') || ['__proto__', 'constructor', 'prototype'].includes(name) || fields.value.some(field => field.name === name)) { keyError.value = '请输入唯一字段名，不含点号或保留名称'; return }
  setField(name, emptyValue({ type: newType.value })); newKey.value = ''; keyError.value = ''
}
function setItem(index: number, value: unknown) { const next = [...arrayValue.value]; next[index] = value; emit('update:value', next) }
function scalar(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return
  const value = target.value
  emit('update:value', props.schema.type === 'number' ? value === '' ? undefined : Number(value) : props.schema.type === 'boolean' ? value === '' ? undefined : value === 'true' : value)
}
</script>
<template>
  <div class="parameter-value">
    <input v-if="schema.type === 'string'" :aria-label="path" :value="typeof value === 'string' ? value : ''" placeholder="输入文本" @input="scalar" />
    <input v-else-if="schema.type === 'number'" type="number" step="any" :aria-label="path" :value="typeof value === 'number' ? value : ''" placeholder="输入数字" @input="scalar" />
    <select v-else-if="schema.type === 'boolean'" :aria-label="path" :value="typeof value === 'boolean' ? String(value) : ''" @change="scalar"><option value="">未填写</option><option value="true">是（true）</option><option value="false">否（false）</option></select>
    <div v-else-if="schema.type === 'object'" class="value-group">
      <div v-for="field in fields" :key="field.name" class="value-field">
        <div class="value-label"><span>{{ field.name }}<b v-if="'required' in field && field.required"> *</b></span><button v-if="!schema.properties?.some(item => item.name === field.name)" type="button" :aria-label="`删除字段 ${path}.${field.name}`" @click="setField(field.name, undefined)">删除</button></div>
        <ParameterValueEditor :schema="field" :value="objectValue[field.name]" :path="`${path}.${field.name}`" @update:value="setField(field.name, $event)" />
      </div>
      <div v-if="!schema.properties" class="add-key"><input v-model="newKey" :aria-label="`${path} 新字段名`" placeholder="字段名" /><select v-model="newType" :aria-label="`${path} 新字段类型`"><option v-for="(label, type) in parameterTypeLabels" :key="type" :value="type">{{ label }}</option></select><button type="button" @click="addField">添加字段</button></div>
      <small v-if="keyError" role="alert">{{ keyError }}</small>
      <button v-if="value === undefined" type="button" class="subtle" @click="emit('update:value', {})">使用空对象</button>
    </div>
    <div v-else class="value-group">
      <div v-for="(item, index) in arrayValue" :key="index" class="value-field">
        <div class="value-label"><span>第 {{ index + 1 }} 项</span><button type="button" :aria-label="`删除 ${path} 第${index + 1}项`" @click="emit('update:value', arrayValue.filter((_, i) => i !== index))">删除</button></div>
        <ParameterValueEditor :schema="schema.items || inferValueSchema(item)" :value="item" :path="`${path}.${index}`" @update:value="setItem(index, $event)" />
      </div>
      <button type="button" :aria-label="`添加 ${path} 项目`" @click="emit('update:value', [...arrayValue, emptyValue(schema.items || { type: 'string' })])">＋ 添加项目</button>
      <button v-if="value === undefined" type="button" class="subtle" @click="emit('update:value', [])">使用空数组</button>
    </div>
  </div>
</template>
<style scoped>
.parameter-value { min-width: 0; } input, select { width: 100%; min-width: 0; padding: 8px 10px; border: 1px solid #dce3ec; border-radius: 5px; color: #24344d; background: white; font-size: 13px; }
.value-group { padding: 12px; border: 1px solid #e1e6ef; border-radius: 6px; background: #f9fbfe; display: grid; gap: 10px; }
.value-label { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px; } b, small { color: #cb4141; } button { padding: 5px 8px; border: 1px solid #dce3ec; border-radius: 4px; background: white; color: #1677ff; font-size: 12px; }
.value-label button { border: 0; padding: 0; color: #8b5960; } .subtle { color: #718096; } .add-key { display: flex; gap: 6px; } .add-key select { width: 85px; } .add-key button { flex-shrink: 0; }
</style>
