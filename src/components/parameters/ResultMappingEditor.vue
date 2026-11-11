<script setup lang="ts">
import type { Workflow } from '../../types'
import ValueSourcePicker from './ValueSourcePicker.vue'
import InputMappingEditor from './InputMappingEditor.vue'
defineProps<{ expression?: string; mapping?: Record<string, string>; workflow: Workflow; nodeId: string }>()
const emit = defineEmits<{ change: [config: { resultExpression?: string; resultMapping?: Record<string, string> }] }>()
function mode(event: Event) { if (event.target instanceof HTMLSelectElement) emit('change', event.target.value === 'fields' ? { resultExpression: undefined, resultMapping: {} } : { resultExpression: undefined, resultMapping: undefined }) }
</script>
<template>
  <div><select class="result-mode" aria-label="最终结果模式" :value="mapping === undefined ? 'direct' : 'fields'" @change="mode"><option value="direct">直接返回一个结果</option><option value="fields">组合多个输出字段</option></select>
    <ValueSourcePicker v-if="mapping === undefined" :model-value="expression || ''" :workflow="workflow" :node-id="nodeId" @update:model-value="emit('change', { resultExpression: $event, resultMapping: undefined })" />
    <InputMappingEditor v-else :model-value="mapping" :workflow="workflow" :node-id="nodeId" add-label="添加结果字段" @update:model-value="emit('change', { resultExpression: undefined, resultMapping: $event })" />
    <small v-if="!expression && mapping === undefined">未选择时，按原约定返回上游输入。</small>
  </div>
</template>
<style scoped>.result-mode { width: 100%; padding: 8px; border: 1px solid #dce3ec; border-radius: 5px; margin-bottom: 10px; background: white; color: #344158; font-size: 12px; }small { display: block; color: #8490a3; font-size: 11px; margin-top: 8px; }</style>
