<script setup lang="ts">
import { computed } from 'vue'
import type { Workflow } from '../../types'
import { toRequestValue, type RequestValue } from '../../../server/src/shared/requestValues'
import RequestValueEditor from './RequestValueEditor.vue'
interface HttpEditorValue { method?: string; headers?: Record<string, string>; body?: unknown; requestQuery?: Record<string, RequestValue>; requestHeaders?: Record<string, RequestValue>; requestBody?: RequestValue }
const props = defineProps<{ modelValue: HttpEditorValue; workflow: Workflow; nodeId: string }>()
const emit = defineEmits<{ change: [patch: Partial<HttpEditorValue>] }>()
const query = computed<RequestValue>(() => ({ kind: 'object', fields: props.modelValue.requestQuery || {} }))
const headers = computed<RequestValue>(() => props.modelValue.requestHeaders ? { kind: 'object', fields: props.modelValue.requestHeaders } : toRequestValue(props.modelValue.headers || {}, true))
const body = computed(() => {
  if (props.modelValue.requestBody !== undefined) return props.modelValue.requestBody
  if (props.modelValue.body === undefined) return undefined
  if (typeof props.modelValue.body === 'string') { try { return toRequestValue(JSON.parse(props.modelValue.body), true) } catch { return undefined } }
  return toRequestValue(props.modelValue.body)
})
function updateQuery(value: RequestValue) { if (value.kind === 'object') emit('change', { requestQuery: value.fields }) }
function updateHeaders(value: RequestValue) { if (value.kind === 'object') emit('change', { headers: undefined, requestHeaders: value.fields }) }
</script>
<template>
  <div class="http-parameters">
    <details><summary>查询参数</summary><RequestValueEditor :model-value="query" :workflow="workflow" :node-id="nodeId" path="查询参数" object-only @update:model-value="updateQuery" /></details>
    <details><summary>请求头</summary><RequestValueEditor :model-value="headers" :workflow="workflow" :node-id="nodeId" path="请求头" object-only @update:model-value="updateHeaders" /></details>
    <div v-if="String(modelValue.method || 'GET').toUpperCase() !== 'GET'" class="body"><label>请求体</label><RequestValueEditor v-if="body" :model-value="body" :workflow="workflow" :node-id="nodeId" path="请求体" @update:model-value="emit('change', { body: undefined, requestBody: $event })" /><template v-else><p v-if="modelValue.body !== undefined" class="legacy">原请求体暂不能无损转换，保持原值。确认切换后才会替换。</p><button type="button" @click="emit('change', { body: undefined, requestBody: { kind: 'object', fields: {} } })">{{ modelValue.body === undefined ? '添加请求体' : '改用可视化请求体' }}</button></template></div>
  </div>
</template>
<style scoped>.http-parameters { display: grid; gap: 16px; }summary, label { display: block; color: #344158; font-size: 13px; font-weight: 500; margin-bottom: 9px; }summary { cursor: pointer; }.body { margin-top: 5px; }.legacy { color: #926a26; font-size: 12px; line-height: 1.6; }button { padding: 7px 10px; border: 1px solid #dce3ec; border-radius: 4px; background: white; color: #1677ff; font-size: 12px; }</style>
