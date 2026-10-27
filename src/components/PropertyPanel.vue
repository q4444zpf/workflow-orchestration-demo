<template>
  <div class="property-panel">
    <div v-if="!node">请选择一个节点</div>
    <div v-else>
      <el-form label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="localData.label" />
        </el-form-item>

        <template v-if="node.type === 'start'">
          <el-form-item label="初始输入">
            <el-input v-model="inputMappingText" type="textarea" :rows="4" />
          </el-form-item>
        </template>

        <template v-if="node.type === 'end'">
          <el-form-item label="结果表达式">
            <el-input v-model="localData.resultExpression" placeholder="ctx.nodeId.output" />
          </el-form-item>
        </template>

        <template v-if="node.type === 'http'">
          <el-form-item label="选择API">
            <el-select v-model="selectedApiId" @change="onApiChange">
              <el-option v-for="api in apis" :key="api.id" :label="api.name" :value="api.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="Method">
            <el-input v-model="localData.method" />
          </el-form-item>
          <el-form-item label="URL">
            <el-input v-model="localData.url" />
          </el-form-item>
          <el-form-item label="Body">
            <el-input v-model="bodyText" type="textarea" :rows="4" />
          </el-form-item>
        </template>

        <template v-if="node.type === 'python'">
          <el-form-item label="输入变量">
            <el-input v-model="localData.inputVars" placeholder="INPUT" />
          </el-form-item>
          <el-form-item label="输出变量">
            <el-input v-model="localData.outputVar" placeholder="OUTPUT" />
          </el-form-item>
          <el-form-item label="输入映射">
            <el-input v-model="inputMappingText" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item label="代码">
            <div ref="editorRef" class="monaco-editor" />
          </el-form-item>
        </template>

        <template v-if="node.type === 'branch'">
          <el-form-item label="条件表达式">
            <el-input v-model="localData.condition" placeholder="ctx.nodeId.output > 0" />
          </el-form-item>
        </template>

        <template v-if="node.type === 'loop'">
          <el-form-item label="迭代表达式">
            <el-input v-model="localData.iteratorExpression" placeholder="ctx.nodeId.output.items" />
          </el-form-item>
        </template>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import type { TypedNode, RegisteredApi } from '../types/index.js'

;(self as any).MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  }
}

const props = defineProps<{ node: TypedNode | null; apis: RegisteredApi[] }>()
const emit = defineEmits<{ 'update:node': [node: TypedNode] }>()

const localData = reactive<Record<string, any>>({})
const selectedApiId = ref<number | null>(null)
const editorRef = ref<HTMLElement>()
const bodyText = ref('')
const inputMappingText = ref('')
let editor: monaco.editor.IStandaloneCodeEditor | null = null

function disposeEditor() {
  if (editor) {
    editor.dispose()
    editor = null
  }
}

function resetLocalData(node: TypedNode) {
  Object.keys(localData).forEach((key) => delete localData[key])
  Object.assign(localData, node.data)
  selectedApiId.value = node.data.apiId || null
  bodyText.value = typeof node.data.body === 'string'
    ? node.data.body
    : JSON.stringify(node.data.body || {}, null, 2)
  inputMappingText.value = JSON.stringify(node.data.inputMapping || {}, null, 2)
}

function emitUpdate() {
  if (!props.node) return
  emit('update:node', { ...props.node, data: { ...localData } })
}

function updateBodyFromText() {
  if (!props.node) return
  const method = String(localData.method || 'GET').toUpperCase()
  if (method !== 'GET') {
    try {
      localData.body = JSON.parse(bodyText.value)
    } catch {
      localData.body = bodyText.value
    }
  } else {
    localData.body = bodyText.value
  }
}

watch(() => props.node?.id, async (newId, oldId) => {
  disposeEditor()
  if (!props.node) return
  if (newId !== oldId) {
    resetLocalData(props.node)
  }
  await nextTick()
  if (props.node.type === 'python' && editorRef.value) {
    editor = monaco.editor.create(editorRef.value, {
      value: localData.code || '# Python code\nOUTPUT = INPUT',
      language: 'python',
      theme: 'vs',
      minimap: { enabled: false }
    })
    editor.onDidChangeModelContent(() => {
      localData.code = editor?.getValue() || ''
    })
  }
}, { immediate: true })

onBeforeUnmount(() => {
  disposeEditor()
})

watch(localData, () => emitUpdate(), { deep: true })

watch(bodyText, updateBodyFromText)
watch(() => localData.method, updateBodyFromText)

watch(inputMappingText, (v) => {
  if (!props.node) return
  try {
    localData.inputMapping = JSON.parse(v)
  } catch {
    ElMessage.error('输入映射必须是合法 JSON')
  }
})

function onApiChange(id: number) {
  const api = props.apis.find((a) => a.id === id)
  if (!api || !props.node) return
  localData.apiId = api.id
  localData.method = api.method
  localData.url = api.url
  localData.headers = api.headers
}
</script>

<style scoped>
.property-panel { width: 320px; padding: 12px; border-left: 1px solid #dcdfe6; overflow-y: auto; }
.monaco-editor { height: 200px; border: 1px solid #dcdfe6; }
</style>
