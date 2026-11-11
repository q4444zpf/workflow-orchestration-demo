<script setup lang="ts">
import { computed } from 'vue'
import type { ValueSchema } from '../../../server/src/shared/parameterSchema'
import InputMappingEditor from './InputMappingEditor.vue'
import type { ValueSource } from './valueSources'
const props = defineProps<{ modelValue?: Record<string, string>; base: string; schema?: ValueSchema; allowPassthrough?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [mapping: Record<string, string> | undefined] }>()
const sources = computed<ValueSource[]>(() => [{ id: props.base, kind: 'result', label: props.base === 'RESULT' ? 'HTTP 响应' : 'Python 执行结果', path: props.base, schema: props.schema }])
function mode(event: Event) { if (event.target instanceof HTMLSelectElement) emit('update:modelValue', event.target.value === 'all' ? undefined : {}) }
</script>
<template>
  <div><select v-if="allowPassthrough" class="output-mode" aria-label="输出模式" :value="modelValue === undefined ? 'all' : 'fields'" @change="mode"><option value="all">返回完整响应</option><option value="fields">选择输出字段</option></select>
    <InputMappingEditor v-if="!allowPassthrough || modelValue !== undefined" :model-value="modelValue || {}" :sources="sources" add-label="添加输出字段" @update:model-value="emit('update:modelValue', $event)" />
    <p class="hint">{{ base === 'RESULT' ? '可选取响应数据、状态及响应头。' : '代码结果赋给 OUTPUT，再选择完整值或其中的子字段。' }}</p>
  </div>
</template>
<style scoped>.output-mode { width: 100%; padding: 8px; border: 1px solid #dce3ec; border-radius: 5px; margin-bottom: 10px; background: white; color: #344158; font-size: 12px; }.hint { color: #8490a3; font-size: 11px; line-height: 1.6; margin: 8px 0; }</style>
