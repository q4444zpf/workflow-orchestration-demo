<template>
  <aside class="property-panel" aria-label="节点配置">
    <div v-if="!node" class="property-empty"><Operation /><h3>节点配置</h3><p>点击画布中的节点<br>查看并编辑它的配置</p></div>
    <template v-else>
      <header class="property-heading"><component :is="nodeMeta(node.type).icon" :style="{ color: nodeMeta(node.type).color }" /><div><h2>{{ nodeName(node) }}</h2><p>{{ nodeMeta(node.type).label }} 节点 · {{ nodeMeta(node.type).description }}</p>
        <div class="node-identity"><span>节点 ID</span><input class="node-id-value" aria-label="节点 ID" :value="node.id" :title="node.id" readonly /><button type="button" aria-label="复制节点 ID" title="复制节点 ID" @click="copyNodeId"><CopyDocument /></button></div>
      </div></header>
      <el-form label-position="top" class="node-form">
        <el-form-item label="节点名称"><el-input v-model="localData.label" :placeholder="nodeMeta(node.type).label" /></el-form-item>
        <template v-if="node.type === 'start'"><div class="config-section"><label>开始节点输出</label><select class="config-select" aria-label="开始输出模式" :value="customStart ? 'fields' : 'all'" @change="changeStartMode"><option value="all">全部运行参数（默认）</option><option value="fields">自定义输出字段</option></select><InputMappingEditor v-if="customStart" :model-value="localData.inputMapping || {}" :workflow="currentWorkflow" :node-id="node.id" @update:model-value="localData.inputMapping = $event" /><p class="field-help">默认透传全部有效参数，包括默认值。</p></div></template>
        <template v-if="node.type === 'end'"><div class="config-section"><label>最终输出结果</label><ResultMappingEditor :expression="localData.resultExpression" :mapping="localData.resultMapping" :workflow="currentWorkflow" :node-id="node.id" @change="Object.assign(localData, $event)" /></div></template>
        <template v-if="node.type === 'http'">
          <el-form-item label="已注册 API"><el-select v-model="selectedApiId" placeholder="选择 API" @change="onApiChange"><el-option v-for="api in apis" :key="api.id" :label="api.name" :value="api.id" /></el-select></el-form-item>
          <el-form-item label="请求方法"><el-select v-model="localData.method"><el-option v-for="method in ['GET', 'POST', 'PUT', 'DELETE']" :key="method" :label="method" :value="method" /></el-select></el-form-item>
          <el-form-item label="请求地址"><el-input v-model="localData.url" placeholder="https://example.com/api" /></el-form-item>
          <HttpParametersEditor :model-value="localData" :workflow="currentWorkflow" :node-id="node.id" @change="Object.assign(localData, $event)" />
          <div class="config-section"><label>响应输出</label><OutputMappingEditor :model-value="localData.outputMapping" base="RESULT" :schema="httpResponseSchema" allow-passthrough @update:model-value="localData.outputMapping = $event" /></div>
        </template>
        <template v-if="node.type === 'python'">
          <div class="config-section"><label>代码输入参数</label><InputMappingEditor :model-value="localData.inputMapping || {}" :workflow="currentWorkflow" :node-id="node.id" @update:model-value="localData.inputMapping = $event" /><p class="field-help">目标参数名会成为 Python 代码中的变量名。</p></div>
          <div class="code-shell" :class="{ expanded: codeExpanded }" :role="codeExpanded ? 'dialog' : undefined" :aria-modal="codeExpanded || undefined" aria-label="Python 代码编辑器" @keydown.esc.stop="codeExpanded = false">
            <div class="code-heading"><span>代码</span><button type="button" @click="codeExpanded = !codeExpanded"><FullScreen />{{ codeExpanded ? '收起' : '展开' }}</button></div>
            <div ref="editorRef" class="monaco-editor" />
          </div>
          <div class="config-section"><label>输出字段</label><OutputMappingEditor :model-value="localData.outputMapping" :base="localData.outputVar || 'OUTPUT'" @update:model-value="localData.outputMapping = $event" /></div>
        </template>
        <BranchEditor v-if="node.type === 'branch'" :key="node.id" v-model="localData.branches" />
        <template v-if="node.type === 'loop'"><div class="config-section"><label>循环数组来源</label><ValueSourcePicker :model-value="localData.iteratorExpression || ''" :workflow="currentWorkflow" :node-id="node.id" @update:model-value="localData.iteratorExpression = $event" /><p class="field-help">使用 body 连接循环体，next 连接后续节点。</p></div></template>
        <p v-if="node.type === 'parallel'" class="field-help">将分支连线标为 fork-0、fork-1 等，汇合连线标为 join。</p>
        <details v-if="node.type === 'http' || node.type === 'python'" class="advanced-config"><summary>输出字段结构（供下游选择）</summary><ParameterSchemaEditor :model-value="localData.outputSchema?.properties || []" @update:model-value="localData.outputSchema = { type: 'object', properties: $event }" /></details>
        <details v-if="node.type === 'http' || node.type === 'python'" class="advanced-config"><summary>重试设置</summary>
          <label v-if="node.type === 'http' && String(localData.method || 'GET').toUpperCase() !== 'GET'" class="retry-declaration"><input v-model="localData.idempotent" type="checkbox" aria-label="外部接口支持幂等" />外部接口支持幂等键去重</label>
          <label class="retry-attempts">最大尝试次数<input aria-label="最大尝试次数" type="number" :value="localData.retry?.maxAttempts || (canRetry ? 3 : 1)" min="1" :max="canRetry ? 3 : 1" @input="updateAttempts" /></label>
          <p class="field-help">{{ canRetry ? '包含首次执行，最多尝试 3 次。失败可能再次执行该节点。' : '写操作默认只尝试 1 次。仅当外部服务实际支持幂等键去重时，才能声明支持并启用重试。' }}</p>
        </details>
      </el-form>
      <footer class="property-footer">
        <button type="button" class="delete-node-button" aria-label="删除节点" @click="emit('delete-node', node.id)"><Delete />删除节点</button>
        <span>也可选中画布节点后按 <kbd>Delete</kbd> 删除</span>
      </footer>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { reactive, ref, shallowRef, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { CopyDocument, Delete, FullScreen, Operation } from '@element-plus/icons-vue'
import { nodeMeta, nodeName } from './nodePresentation'
import { ElMessage } from 'element-plus'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import type { TypedNode, RegisteredApi, Workflow } from '../types/index.js'
import type { ValueSchema } from '../../server/src/shared/parameterSchema'
import InputMappingEditor from './parameters/InputMappingEditor.vue'
import OutputMappingEditor from './parameters/OutputMappingEditor.vue'
import ResultMappingEditor from './parameters/ResultMappingEditor.vue'
import HttpParametersEditor from './parameters/HttpParametersEditor.vue'
import ValueSourcePicker from './parameters/ValueSourcePicker.vue'
import ParameterSchemaEditor from './parameters/ParameterSchemaEditor.vue'
import BranchEditor from './BranchEditor.vue'
import { getBranchDefinitions } from '../../server/src/shared/branches'

;(self as any).MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  }
}

const props = defineProps<{ node: TypedNode | null; apis: RegisteredApi[]; workflow?: Workflow }>()
const emit = defineEmits<{ 'update:node': [node: TypedNode]; 'delete-node': [id: string] }>()

const localData = reactive<Record<string, any>>({})
const selectedApiId = ref<number | null>(null)
const editorRef = ref<HTMLElement>()
const customStart = shallowRef(false)
const currentWorkflow = computed<Workflow>(() => props.workflow || { name: '', nodes: props.node ? [props.node] : [], edges: [] })
const httpResponseSchema: ValueSchema = { type: 'object', properties: [{ name: 'status', type: 'number' }, { name: 'headers', type: 'object' }, { name: 'data', type: 'object' }] }
function changeStartMode(event: Event) { if (!(event.target instanceof HTMLSelectElement)) return; customStart.value = event.target.value === 'fields'; if (!customStart.value) localData.inputMapping = {} }
const codeExpanded = ref(false)
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let resetting = false
const canRetry = computed(() => props.node?.type === 'python' || String(localData.method || 'GET').toUpperCase() === 'GET' || localData.idempotent === true)
async function copyNodeId() {
  const id = props.node?.id
  if (!id) return
  try {
    await navigator.clipboard.writeText(id)
    ElMessage.success('节点 ID 已复制')
  } catch {
    ElMessage.error('复制失败，请选中节点 ID 手动复制')
  }
}
function updateAttempts(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return
  const value = Number(event.target.value)
  localData.retry = { ...localData.retry, maxAttempts: Math.max(1, Math.min(canRetry.value ? 3 : 1, Number.isFinite(value) ? Math.floor(value) : 1)) }
}
watch(canRetry, allowed => { if (!resetting && !allowed) localData.retry = { ...localData.retry, maxAttempts: 1 } })

function disposeEditor() {
  if (editor) {
    editor.dispose()
    editor = null
  }
}

function resetLocalData(node: TypedNode) {
  Object.keys(localData).forEach((key) => delete localData[key])
  Object.assign(localData, JSON.parse(JSON.stringify(node.data)))
  if (node.type === 'branch') localData.branches = getBranchDefinitions(node.data).map(branch => ({ ...branch }))
  if (node.type === 'http' || node.type === 'python') localData.retry = { ...localData.retry, maxAttempts: localData.retry?.maxAttempts || (canRetry.value ? 3 : 1) }
  selectedApiId.value = node.data.apiId || null
  customStart.value = Object.keys(node.data.inputMapping || {}).length > 0
}

function emitUpdate() {
  if (!props.node) return
  emit('update:node', { ...props.node, data: JSON.parse(JSON.stringify(localData)) })
}

watch(() => props.node?.id, async (newId, oldId) => {
  resetting = true
  disposeEditor()
  codeExpanded.value = false
  if (!props.node) { resetting = false; return }
  if (newId !== oldId) {
    resetLocalData(props.node)
  }
  await nextTick()
  if (props.node?.id !== newId) return
  resetting = false
  if (props.node.type === 'python' && editorRef.value) {
    editor = monaco.editor.create(editorRef.value, {
      value: localData.code || '# 在输入配置中定义变量后，可直接在此引用\nOUTPUT = None',
      language: 'python',
      theme: 'vs',
      automaticLayout: true,
      scrollBeyondLastLine: false,
      fontSize: 12,
      wordWrap: 'on',
      lineNumbersMinChars: 2,
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

watch(localData, () => { if (!resetting) emitUpdate() }, { deep: true })

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
.property-panel { width: 400px; flex-shrink: 0; min-height: 0; display: flex; flex-direction: column; padding: 18px 22px; border-left: 1px solid var(--line); overflow: hidden; background: #fff; }
.property-heading { flex-shrink: 0; }
.property-heading > div { flex: 1; min-width: 0; }
.node-identity { display: flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 11px; color: #617088; }
.node-identity > span { flex-shrink: 0; }
.node-id-value { flex: 1; min-width: 0; width: 0; padding: 4px 6px; border: 1px solid #e4e7ed; border-radius: 4px; background: #edf0f5; color: #667085; cursor: default; font: 11px/1.5 Consolas, monospace; }
.node-id-value:focus-visible { outline: 2px solid #1677ff; outline-offset: 1px; }
.node-identity > button { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 4px; border: 0; border-radius: 4px; background: transparent; color: #1677ff; cursor: pointer; }
.node-identity > button:hover { background: #e8f1ff; }
.node-identity > button svg { width: 15px; height: 15px; }
.retry-declaration, .retry-attempts { display: flex; align-items: center; gap: 8px; margin-top: 10px; line-height: 1.6; }
.retry-attempts input { width: 60px; padding: 6px; border: 1px solid #dfe5ee; border-radius: 4px; }
.node-form { flex: 1; min-height: 0; overflow-y: auto; padding: 2px; }
.config-section { margin-bottom: 20px; }.config-section > label { display: block; margin-bottom: 9px; color: #344158; font-size: 13px; font-weight: 500; }.config-select { width: 100%; padding: 8px; border: 1px solid #dce3ec; border-radius: 5px; background: white; color: #344158; font-size: 12px; margin-bottom: 10px; }
.property-footer { flex-shrink: 0; display: grid; gap: 8px; padding-top: 14px; margin-top: 14px; border-top: 1px solid var(--line); }
.delete-node-button { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; color: #c83f3f; background: #fff6f6; border: 1px solid #efc3c3; border-radius: 6px; font-size: 13px; }
.delete-node-button:hover { background: #ffebeb; border-color: #df8e8e; }
.delete-node-button svg { width: 16px; height: 16px; }
.property-footer span { color: #7a879b; text-align: center; font-size: 11px; }
kbd { font: inherit; padding: 1px 4px; border: 1px solid #dfe5ee; border-radius: 3px; }
.property-heading { display: flex; align-items: center; gap: 12px; background: #f6f8fe; border-radius: 7px; padding: 12px; margin: 0 0 18px; } .property-heading > svg { width: 28px; height: 28px; flex-shrink: 0; } .property-heading h2 { margin: 0 0 5px; font-size: 17px; } .property-heading p { margin: 0; color: #7a879b; font-size: 12px; } .node-form :deep(.el-form-item) { margin-bottom: 18px; } .node-form :deep(.el-form-item__label) { font-size: 13px; font-weight: 500; color: #344158; margin-bottom: 8px; } .node-form :deep(.el-textarea__inner) { padding: 12px; font: 12px/1.7 Consolas, monospace; background: #fbfcff; } .node-form :deep(.el-select) { width: 100%; }
.code-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; font-size: 13px; font-weight: 500; } .code-heading button { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; color: #1677ff; font-size: 12px; } .code-heading button svg { width: 14px; height: 14px; } .monaco-editor { width: 100%; min-width: 0; height: 150px; border: 1px solid #dfe5ee; border-radius: 6px; overflow: hidden; padding-block: 6px; } .code-shell.expanded { position: fixed; inset: 5vh 5vw; background: white; padding: 24px; border: 1px solid var(--line); border-radius: 10px; z-index: 2200; box-shadow: 0 0 0 100vmax #15243b55; display: flex; flex-direction: column; } .expanded .monaco-editor { flex: 1; height: auto; }
.field-help { font-size: 11px; line-height: 1.6; color: #8490a3; margin-top: 6px; } .advanced-config { margin-top: 18px; color: #617088; font-size: 12px; } .advanced-config summary { cursor: pointer; margin-bottom: 14px; } .property-empty { text-align: center; color: #8a96a9; padding-top: 80px; font-size: 13px; line-height: 1.8; } .property-empty svg { width: 28px; height: 28px; } .property-empty h3 { color: #566780; font-size: 15px; }
@media (max-width: 1150px) { .property-panel { width: 300px; padding: 16px; } }
</style>
