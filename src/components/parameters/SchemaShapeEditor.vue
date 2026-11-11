<script setup lang="ts">
import type { ValueSchema, ParameterType } from '../../../server/src/shared/parameterSchema'
import { parameterTypeLabels } from '../../../server/src/shared/parameterSchema'
import ParameterSchemaEditor from './ParameterSchemaEditor.vue'
withDefaults(defineProps<{ modelValue: ValueSchema; depth?: number }>(), { depth: 0 })
const emit = defineEmits<{ 'update:modelValue': [schema: ValueSchema] }>()
function change(event: Event) { if (event.target instanceof HTMLSelectElement) { const type = event.target.value as ParameterType; emit('update:modelValue', { type, ...(type === 'object' ? { properties: [] } : type === 'array' ? { items: { type: 'string' } } : {}) }) } }
</script>
<template>
  <div class="schema-shape"><select aria-label="参数类型" :value="modelValue.type" @change="change"><option v-for="(label, type) in parameterTypeLabels" :key="type" :value="type">{{ label }}</option></select>
    <div v-if="depth < 12 && modelValue.type === 'object'" class="children"><span>对象字段</span><ParameterSchemaEditor :model-value="modelValue.properties || []" :depth="depth + 1" @update:model-value="emit('update:modelValue', { ...modelValue, properties: $event })" /></div>
    <div v-if="depth < 12 && modelValue.type === 'array'" class="children"><span>数组元素类型</span><SchemaShapeEditor :model-value="modelValue.items || { type: 'string' }" :depth="depth + 1" @update:model-value="emit('update:modelValue', { ...modelValue, items: $event })" /></div>
  </div>
</template>
<style scoped>
select { width: 100%; padding: 7px 9px; border: 1px solid #dce3ec; border-radius: 5px; background: white; font-size: 13px; color: #344158; }.children { margin: 10px 0 0 10px; padding-left: 12px; border-left: 2px solid #dbe7fb; }.children > span { display: block; font-size: 12px; color: #718096; margin-bottom: 8px; }
</style>
