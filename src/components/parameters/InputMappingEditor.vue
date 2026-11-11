<script setup lang="ts">
import { shallowRef, computed } from 'vue'
import type { Workflow } from '../../types'
import ValueSourcePicker from './ValueSourcePicker.vue'
import { availableSources, type ValueSource } from './valueSources'
const props = defineProps<{ modelValue: Record<string, string>; workflow?: Workflow; nodeId?: string; sources?: ValueSource[]; addLabel?: string }>()
const emit = defineEmits<{ 'update:modelValue': [mapping: Record<string, string>] }>()
const error = shallowRef('')
const sources = computed(() => props.sources || (props.workflow ? availableSources(props.workflow, props.nodeId || '') : []))
function rename(name: string, event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return
  if (!Object.prototype.hasOwnProperty.call(props.modelValue, name)) return
  const next = event.target.value.trim()
  if (!next || next.includes('.') || ['__proto__', 'constructor', 'prototype'].includes(next) || next !== name && Object.prototype.hasOwnProperty.call(props.modelValue, next)) { error.value = '字段名称须非空且唯一，不能含点号或保留名称'; event.target.value = name; return }
  error.value = ''; emit('update:modelValue', Object.fromEntries(Object.entries(props.modelValue).map(([key, value]) => [key === name ? next : key, value])))
}
function add() { let index = 1; while (Object.prototype.hasOwnProperty.call(props.modelValue, `param${index}`)) index++; emit('update:modelValue', { ...props.modelValue, [`param${index}`]: sources.value[0]?.path || '' }) }
</script>
<template>
  <div class="mapping-editor">
    <div v-for="(path, name) in modelValue" :key="name" class="mapping-row" :data-mapping-key="name"><div class="mapping-name"><input aria-label="目标参数名" :value="name" placeholder="目标参数名" @change="rename(String(name), $event)" @blur="rename(String(name), $event)" /><button type="button" :aria-label="`删除映射 ${name}`" @click="emit('update:modelValue', Object.fromEntries(Object.entries(modelValue).filter(([key]) => key !== name)))">删除</button></div><ValueSourcePicker :model-value="path" :sources="sources" @update:model-value="emit('update:modelValue', { ...modelValue, [name]: $event })" /></div>
    <p v-if="!Object.keys(modelValue).length" class="empty">尚未配置字段</p><p v-if="error" role="alert" class="error">{{ error }}</p>
    <button type="button" class="add" aria-label="添加映射字段" @click="add">＋ {{ addLabel || '添加字段' }}</button>
  </div>
</template>
<style scoped>
.mapping-editor { display: grid; gap: 10px; }.mapping-row { padding: 10px; border: 1px solid #e1e6ef; border-radius: 6px; background: #f9fbfe; }.mapping-name { display: flex; gap: 8px; margin-bottom: 8px; }input { flex: 1; width: 0; min-width: 0; padding: 7px 9px; border: 1px solid #dce3ec; border-radius: 5px; font-size: 12px; }.mapping-name button { border: 0; color: #ae5260; background: none; }.add { justify-self: start; border: 1px solid #dce3ec; background: white; color: #1677ff; padding: 6px 10px; border-radius: 4px; font-size: 12px; }.empty { margin: 0; color: #8490a3; font-size: 12px; }.error { color: #bd4545; margin: 0; font-size: 12px; }
</style>
