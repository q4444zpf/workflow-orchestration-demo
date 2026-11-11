<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { Workflow } from '../../types'
import { availableSources, schemaFields, type ValueSource } from './valueSources'
const props = defineProps<{ modelValue: string; workflow?: Workflow; nodeId?: string; sources?: ValueSource[] }>()
const emit = defineEmits<{ 'update:modelValue': [path: string] }>()
const roots = computed(() => props.sources || (props.workflow ? availableSources(props.workflow, props.nodeId || '') : []))
const active = computed(() => [...roots.value].sort((a, b) => b.path.length - a.path.length).find(root => props.modelValue === root.path || props.modelValue.startsWith(root.path + '.')))
const category = shallowRef('workflow')
const kind = computed(() => active.value?.kind || category.value)
const rootOptions = computed(() => roots.value.filter(root => root.kind === kind.value))
const kinds = computed(() => [...new Set([...roots.value.map(root => root.kind), kind.value])])
const labels: Record<string, string> = { workflow: '工作流参数', node: '节点输出', local: '循环当前元素', result: '当前执行结果' }
const suffix = computed(() => active.value ? props.modelValue.slice(active.value.path.length).replace(/^\./, '') : '')
const fieldOptions = computed(() => schemaFields(active.value?.schema))
const custom = shallowRef(false)
const isCustom = computed(() => custom.value || Boolean(suffix.value && !fieldOptions.value.some(field => field.path === suffix.value)))
function changeKind(event: Event) { if (!(event.target instanceof HTMLSelectElement)) return; category.value = event.target.value; custom.value = false; const root = roots.value.find(root => root.kind === category.value); emit('update:modelValue', root?.path || '') }
function changeRoot(event: Event) { if (!(event.target instanceof HTMLSelectElement)) return; custom.value = false; emit('update:modelValue', event.target.value) }
function changeField(event: Event) { if (!(event.target instanceof HTMLSelectElement) || !active.value) return; if (event.target.value === '__custom') { custom.value = true; return }; custom.value = false; emit('update:modelValue', active.value.path + (event.target.value ? `.${event.target.value}` : '')) }
function fieldText(event: Event) { if (event.target instanceof HTMLInputElement && active.value) emit('update:modelValue', active.value.path + (event.target.value ? `.${event.target.value}` : '')) }
</script>
<template>
  <div class="source-picker">
    <select aria-label="输入来源类型" :value="kind" @change="changeKind"><option v-for="item in kinds" :key="item" :value="item">{{ labels[item] }}</option></select>
    <select aria-label="来源参数或节点" :value="active?.path || ''" @change="changeRoot"><option value="" disabled>请选择来源</option><option v-for="root in rootOptions" :key="root.path" :value="root.path">{{ root.label }}</option></select>
    <select v-if="active" aria-label="来源字段" :value="isCustom ? '__custom' : suffix" @change="changeField"><option value="">完整值</option><option v-for="field in fieldOptions" :key="field.path" :value="field.path">{{ field.label }}</option><option value="__custom">指定子字段…</option></select>
    <input v-if="active && isCustom" aria-label="子字段路径" :value="suffix" placeholder="例如 result.score 或 data.user.name" @input="fieldText" />
    <p v-if="modelValue && !active" class="source-error" role="alert">原来源不可用，请重新选择。<small>{{ modelValue }}</small></p>
    <p v-else-if="!roots.length" class="source-empty">请先配置工作流参数或连接上游节点。</p>
  </div>
</template>
<style scoped>
.source-picker { display: grid; grid-template-columns: 1fr; gap: 6px; min-width: 0; }select, input { width: 100%; min-width: 0; padding: 7px 9px; border: 1px solid #dce3ec; border-radius: 5px; color: #344158; font-size: 12px; background: white; }.source-error { color: #bd4545; font-size: 12px; margin: 2px 0; }.source-error small { display: block; overflow-wrap: anywhere; }.source-empty { margin: 0; color: #8490a3; font-size: 12px; }
</style>
