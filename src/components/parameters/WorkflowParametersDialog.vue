<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import ParameterDialog from './ParameterDialog.vue'
import ParameterSchemaEditor from './ParameterSchemaEditor.vue'
import { validateParameterDefinitions, type WorkflowVariable, type ParameterIssue } from '../../../server/src/shared/parameterSchema'
const props = defineProps<{ modelValue: WorkflowVariable[] }>()
const emit = defineEmits<{ submit: [fields: WorkflowVariable[]]; cancel: [] }>()
const fields = ref<WorkflowVariable[]>(JSON.parse(JSON.stringify(props.modelValue)))
const issues = shallowRef<ParameterIssue[]>([])
function submit() { issues.value = validateParameterDefinitions(fields.value); if (!issues.value.length) emit('submit', fields.value) }
</script>
<template>
  <ParameterDialog title="工作流参数配置" wide @close="emit('cancel')"><form @submit.prevent="submit">
    <p class="intro">先定义参数名称与结构，运行时会生成对应表单。对象可包含子字段，数组可包含对象或数组。</p>
    <ParameterSchemaEditor v-model="fields" />
    <p v-for="(issue, index) in issues" :key="index" role="alert" class="error">{{ issue.message }}</p>
    <footer><button type="button" @click="emit('cancel')">取消</button><button type="submit" class="primary">确认配置</button></footer>
  </form></ParameterDialog>
</template>
<style scoped>
.intro { margin: 0 0 20px; color: #718096; line-height: 1.7; font-size: 13px; }.error { color: #c84040; font-size: 12px; }footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }button { padding: 8px 16px; border: 1px solid #dce3ec; border-radius: 5px; background: white; color: #344158; }.primary { background: #1677ff; color: white; border-color: #1677ff; }
</style>
