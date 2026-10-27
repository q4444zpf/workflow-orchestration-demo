<template>
  <div class="property-panel">
    <div v-if="!node">请选择一个节点</div>
    <div v-else>
      <el-form label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="node.data.label" />
        </el-form-item>

        <template v-if="node.type === 'start'">
          <el-form-item label="初始输入">
            <el-input v-model="inputMappingText" type="textarea" :rows="4" />
          </el-form-item>
        </template>

        <template v-if="node.type === 'end'">
          <el-form-item label="结果表达式">
            <el-input v-model="node.data.resultExpression" placeholder="ctx.nodeId.output" />
          </el-form-item>
        </template>

        <template v-if="node.type === 'http'">
          <el-form-item label="选择API">
            <el-select v-model="selectedApiId" @change="onApiChange">
              <el-option v-for="api in apis" :key="api.id" :label="api.name" :value="api.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="Method">
            <el-input v-model="node.data.method" />
          </el-form-item>
          <el-form-item label="URL">
            <el-input v-model="node.data.url" />
          </el-form-item>
          <el-form-item label="Body">
            <el-input v-model="bodyText" type="textarea" :rows="4" />
          </el-form-item>
        </template>

        <template v-if="node.type === 'python'">
          <el-form-item label="输入变量">
            <el-input v-model="node.data.inputVars" placeholder="INPUT" />
          </el-form-item>
          <el-form-item label="输出变量">
            <el-input v-model="node.data.outputVar" placeholder="OUTPUT" />
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
            <el-input v-model="node.data.condition" placeholder="ctx.nodeId.output > 0" />
          </el-form-item>
        </template>

        <template v-if="node.type === 'loop'">
          <el-form-item label="迭代表达式">
            <el-input v-model="node.data.iteratorExpression" placeholder="ctx.nodeId.output.items" />
          </el-form-item>
        </template>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import * as monaco from 'monaco-editor'
import { RegisteredApi } from '../../server/src/types/index.js'

const props = defineProps<{ node: any; apis: RegisteredApi[] }>()

const selectedApiId = ref<number | null>(null)
const editorRef = ref<HTMLElement>()
const bodyText = ref('')
const inputMappingText = ref('')
let editor: monaco.editor.IStandaloneCodeEditor | null = null

watch(() => props.node, async (node) => {
  if (!node) return
  selectedApiId.value = node.data.apiId || null
  bodyText.value = typeof node.data.body === 'string' ? node.data.body : JSON.stringify(node.data.body || {}, null, 2)
  inputMappingText.value = JSON.stringify(node.data.inputMapping || {}, null, 2)

  await nextTick()
  if (node.type === 'python' && editorRef.value) {
    if (editor) editor.dispose()
    editor = monaco.editor.create(editorRef.value, {
      value: node.data.code || '# Python code\nOUTPUT = INPUT',
      language: 'python',
      theme: 'vs',
      minimap: { enabled: false }
    })
    editor.onDidChangeModelContent(() => {
      node.data.code = editor?.getValue()
    })
  }
}, { immediate: true })

watch(bodyText, (v) => {
  if (props.node) props.node.data.body = v
})

watch(inputMappingText, (v) => {
  try {
    if (props.node) props.node.data.inputMapping = JSON.parse(v)
  } catch {}
})

function onApiChange(id: number) {
  const api = props.apis.find((a) => a.id === id)
  if (!api || !props.node) return
  props.node.data.apiId = api.id
  props.node.data.method = api.method
  props.node.data.url = api.url
  props.node.data.headers = api.headers
}
</script>

<style scoped>
.property-panel { width: 320px; padding: 12px; border-left: 1px solid #dcdfe6; overflow-y: auto; }
.monaco-editor { height: 200px; border: 1px solid #dcdfe6; }
</style>
