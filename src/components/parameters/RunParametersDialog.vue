<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import ParameterDialog from './ParameterDialog.vue'
import ParameterValueEditor from './ParameterValueEditor.vue'
import { resolveParameterValues, type WorkflowVariable, type ParameterIssue } from '../../../server/src/shared/parameterSchema'
const props = withDefaults(defineProps<{ definitions: WorkflowVariable[]; initialValues?: Record<string, unknown> }>(), { initialValues: () => ({}) })
const emit = defineEmits<{ submit: [values: Record<string, unknown>]; cancel: []; configure: [] }>()
const values = ref(resolveParameterValues(props.definitions, Object.fromEntries(props.definitions.filter(field => Object.prototype.hasOwnProperty.call(props.initialValues, field.name)).map(field => [field.name, props.initialValues[field.name]]))).values)
const issues = shallowRef<ParameterIssue[]>([])
function update(name: string, value: unknown) { if (value === undefined) delete values.value[name]; else values.value = { ...values.value, [name]: value } }
function submit() { const result = resolveParameterValues(props.definitions, values.value); issues.value = result.issues; if (!result.issues.length) emit('submit', result.values) }
</script>
<template>
  <ParameterDialog title="运行参数" @close="emit('cancel')">
    <form @submit.prevent="submit">
      <p class="intro">按字段填写本次运行参数。默认值已自动填入。</p>
      <div v-if="!definitions.length" class="empty">本流程尚未定义输入参数。<button type="button" @click="emit('configure')">前往参数配置</button>，也可直接以空参数运行。</div>
      <div v-for="field in definitions" :key="field.name" class="run-field"><label>{{ field.name }}<b v-if="field.required"> *</b><small>{{ field.description }}</small></label><ParameterValueEditor :schema="field" :value="values[field.name]" :path="field.name" @update:value="update(field.name, $event)" /><p v-for="issue in issues.filter(item => item.path === field.name || item.path.startsWith(field.name + '.'))" :key="issue.path" role="alert" class="error">{{ issue.message }}</p></div>
      <p v-for="issue in issues.filter(item => item.path === 'parameters')" :key="issue.path" role="alert" class="error">{{ issue.message }}</p>
      <footer><button type="button" aria-label="取消运行" @click="emit('cancel')">取消</button><button type="submit" class="primary">运行</button></footer>
    </form>
  </ParameterDialog>
</template>
<style scoped>
.intro, .empty { margin: 0 0 20px; color: #718096; font-size: 13px; line-height: 1.8; }.run-field { margin-bottom: 20px; } label { display: block; margin-bottom: 8px; font-size: 14px; } small { margin-left: 10px; color: #718096; } b, .error { color: #c84040; }.error { margin: 6px 0 0; font-size: 12px; } footer { display: flex; justify-content: flex-end; gap: 10px; padding-top: 12px; } button { padding: 8px 16px; border: 1px solid #dce3ec; border-radius: 5px; background: white; color: #344158; }.primary { background: #1677ff; color: white; border-color: #1677ff; }.empty button { color: #1677ff; border: 0; padding: 0; }
</style>
