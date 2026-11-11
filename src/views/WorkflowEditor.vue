<template>
  <div class="workflow-editor">
    <header class="toolbar">
      <el-button class="back-button" aria-label="返回工作流列表" @click="router.push('/workflows')"><ArrowLeft />返回列表</el-button>
      <div class="brand"><Share /><strong>执行调试台</strong></div>
      <span class="workspace-label">工作流</span>
      <el-input v-model="workflow.name" class="workflow-name" placeholder="流程名称" aria-label="工作流名称" />
      <span class="save-state" :class="{ dirty: isDirty }"><CircleCheck v-if="!isDirty && workflow.id" />{{ saving ? '保存中' : isDirty || !workflow.id ? '未保存' : '已保存' }}</span>
      <div class="toolbar-actions">
        <el-button :disabled="!workflow.id" @click="router.push(`/executions?workflowId=${workflow.id}`)">执行日志</el-button>
        <el-button @click="parametersDialogOpen = true">参数配置</el-button>
        <el-button @click="checkWorkflow"><CircleCheck />校验</el-button>
        <el-button type="primary" :loading="running" :disabled="execution?.status === 'running'" @click="run"><VideoPlay />运行</el-button>
        <el-button :loading="saving" @click="save">保存</el-button>
        <el-popover trigger="click" placement="bottom-end" :width="300">
          <template #reference><el-button><Promotion />{{ workflow.is_published ? '已发布' : '发布' }}</el-button></template>
          <div class="publish-popover"><h3>发布工作流 API</h3><p>保存后，可通过此路径调用工作流。</p><el-input v-model="publishPath" placeholder="输入发布路径" aria-label="发布路径" :disabled="workflow.is_published" /><el-button v-if="!workflow.is_published" type="primary" :loading="publishing" :disabled="!isPublishPathValid" @click="publish">发布</el-button><el-button v-else type="danger" :loading="publishing" @click="unpublish">取消发布</el-button><small v-if="workflow.publish_path">/api/run/{{ workflow.publish_path }}</small></div>
        </el-popover>
      </div>
    </header>
    <div v-if="selectedEdge" class="edge-editor"><template v-if="selectedEdgeBranches.length"><span>分支出口</span><select aria-label="连线分支出口" :value="selectedEdge.branchId || selectedEdge.sourceHandle || selectedEdge.label" @change="onUpdateEdgeBranch"><option v-for="branch in selectedEdgeBranches" :key="branch.id" :value="branch.id">{{ branch.label }}{{ branch.isDefault ? '（默认）' : '' }}</option></select></template><template v-else><span>连线标签</span><el-input v-model="selectedEdge.label" placeholder="body / next / fork-N / join" style="width:340px" @change="onUpdateEdgeLabel" /></template><el-button text @click="selectedEdge = null">关闭</el-button></div>
    <div class="editor-body">
      <NodeLibrary :apis="apis" />
      <main ref="workspaceRef" class="canvas-workspace">
        <WorkflowValidationPanel v-if="showValidation" :issues="validationIssues" @select-issue="selectValidationIssue" @close="showValidation = false" />
        <div class="graph-workspace">
          <FlowCanvas v-model:nodes="workflow.nodes" v-model:edges="workflow.edges" :execution="execution" @node-click="onNodeClick" @edge-click="onEdgeClick" @delete-nodes="requestDeleteNodes" />
          <PropertyPanel v-model:node="selectedNode" :apis="apis" :workflow="workflow" @update:node="onUpdateNode" @delete-node="deleteNode" />
        </div>
        <div class="monitor-divider" role="separator" tabindex="0" aria-label="调整执行监控高度" aria-orientation="horizontal" :aria-valuenow="monitorHeight" aria-valuemin="220" :aria-valuemax="maxMonitorHeight" @pointerdown="startMonitorResize" @keydown.up.prevent="resizeMonitor(24)" @keydown.down.prevent="resizeMonitor(-24)"><MoreFilled /></div>
        <ExecutionPanel :style="{ flexBasis: monitorHeight + 'px' }" :nodes="workflow.nodes" :execution="execution" :selected-node-id="selectedNodeId" @select-node="selectExecutionNode" />
      </main>
    </div>
    <WorkflowParametersDialog v-if="parametersDialogOpen" :model-value="workflow.variables || []" @submit="applyParameters" @cancel="parametersDialogOpen = false" />
    <RunParametersDialog v-if="runDialogOpen" :definitions="workflow.variables || []" :initial-values="variablesInput" @submit="executeRun" @cancel="runDialogOpen = false" @configure="runDialogOpen = false; parametersDialogOpen = true" />
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, provide, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Share, VideoPlay, CircleCheck, Promotion, MoreFilled, ArrowLeft } from '@element-plus/icons-vue'
import type { Node } from '@vue-flow/core'
import { apiApi, workflowApi } from '../api/index.js'
import { apiErrorMessage, responseData } from '../api/errors'
import { useExecutionMonitor } from '../composables/useExecutionMonitor'
import NodeLibrary from '../components/NodeLibrary.vue'
import FlowCanvas from '../components/FlowCanvas.vue'
import PropertyPanel from '../components/PropertyPanel.vue'
import ExecutionPanel from '../components/ExecutionPanel.vue'
import WorkflowValidationPanel from '../components/WorkflowValidationPanel.vue'
import WorkflowParametersDialog from '../components/parameters/WorkflowParametersDialog.vue'
import RunParametersDialog from '../components/parameters/RunParametersDialog.vue'
import type { WorkflowVariable } from '../../server/src/shared/parameterSchema'
import { invalidReferenceIssues } from '../components/parameters/valueSources'
import { validateWorkflowGraph } from '../../server/src/shared/workflowValidation'
import type { WorkflowValidationIssue } from '../../server/src/shared/workflowValidation'
import { nodeName } from '../components/nodePresentation'
import { getBranchDefinitions } from '../../server/src/shared/branches'
import { syncBranchEdge, configuredBranchIds } from '../components/branchEdges'
import type { Workflow, RegisteredApi, TypedNode, FlowEdge } from '../types/index.js'

function isTypedNode(node: Node): node is TypedNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    typeof node.id === 'string' &&
    typeof node.type === 'string' &&
    typeof node.data === 'object' &&
    node.data !== null
  )
}

const route = useRoute()
const router = useRouter()
const workflow = ref<Workflow>({ name: '新流程', nodes: [], edges: [] })
const showValidation = shallowRef(false)
const validationIssues = computed(() => [...validateWorkflowGraph(workflow.value), ...invalidReferenceIssues(workflow.value)])
function checkWorkflow(): boolean {
  showValidation.value = true
  return validationIssues.value.length === 0
}
function selectValidationIssue(issue: WorkflowValidationIssue) {
  if (issue.edgeId) {
    const edge = workflow.value.edges.find(edge => edge.id === issue.edgeId)
    if (edge) {
      workflow.value.edges = workflow.value.edges.map(item => ({ ...item, selected: item.id === edge.id }))
      workflow.value.nodes = workflow.value.nodes.map(node => ({ ...node, selected: false }))
      onEdgeClick(edge)
      return
    }
  }
  if (issue.nodeId) {
    workflow.value.edges = workflow.value.edges.map(edge => ({ ...edge, selected: false }))
    selectExecutionNode(issue.nodeId)
  }
}
const apis = ref<RegisteredApi[]>([])
const selectedNode = ref<TypedNode | null>(null)
const selectedNodeId = ref<string | null>(null)
const selectedEdge = ref<FlowEdge | null>(null)
const selectedEdgeBranches = computed(() => {
  const source = workflow.value.nodes.find(node => node.id === selectedEdge.value?.source)
  return source?.type === 'branch' ? getBranchDefinitions(source.data) : []
})
watch(() => workflow.value.nodes.map(node => node.id), ids => {
  if (selectedNodeId.value && !ids.includes(selectedNodeId.value)) {
    selectedNode.value = null
    selectedNodeId.value = null
  }
})
watch(() => workflow.value.edges.map(edge => edge.id), ids => {
  if (selectedEdge.value && !ids.includes(selectedEdge.value.id)) selectedEdge.value = null
})
const deleteConfirmationOpen = shallowRef(false)
function deleteNode(id: string) { return requestDeleteNodes([id]) }
async function requestDeleteNodes(ids: string[]) {
  if (deleteConfirmationOpen.value) return
  const nodes = workflow.value.nodes.filter(node => ids.includes(node.id))
  if (!nodes.length) return
  const names = nodes.map(nodeName).slice(0, 3).join('、')
  const target = nodes.length === 1 ? `节点“${names}”` : `这 ${nodes.length} 个节点（${names}${nodes.length > 3 ? '等' : ''}）`
  deleteConfirmationOpen.value = true
  try {
    await ElMessageBox.confirm(`确定删除${target}吗？关联的连线也会一并删除。`, '删除节点', {
      type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger', closeOnClickModal: false,
      distinguishCancelAndClose: true, autofocus: false
    })
    if (disposed) return
    const deletedIds = new Set(nodes.map(node => node.id))
    workflow.value.nodes = workflow.value.nodes.filter(node => !deletedIds.has(node.id))
    workflow.value.edges = workflow.value.edges.filter(edge => !deletedIds.has(edge.source) && !deletedIds.has(edge.target))
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error('删除未完成，请重试')
  } finally {
    deleteConfirmationOpen.value = false
  }
}
const saving = ref(false)
const running = ref(false)
const publishing = ref(false)
const { execution, monitorExecution } = useExecutionMonitor()
const workspaceRef = ref<HTMLElement>()
const monitorHeight = ref(416)
const viewportHeight = ref(window.innerHeight)
const maxMonitorHeight = computed(() => Math.max(220, Math.round((viewportHeight.value - 64) * 0.6)))
function onViewportResize() { viewportHeight.value = window.innerHeight }
const savedFingerprint = ref('')
const fingerprint = computed(() => JSON.stringify({ name: workflow.value.name, variables: workflow.value.variables,
  nodes: workflow.value.nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
  edges: workflow.value.edges.map(e => ({ id: e.id, source: e.source, target: e.target, label: e.label, branchId: e.branchId, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle })) }))
const isDirty = computed(() => fingerprint.value !== savedFingerprint.value)
onBeforeRouteLeave(async () => {
  if (!isDirty.value) return true
  try {
    await ElMessageBox.confirm('工作流有未保存的修改。保存后离开，或放弃本次修改；关闭弹窗可继续编辑。', '未保存的修改', {
      confirmButtonText: '保存并离开', cancelButtonText: '放弃修改', distinguishCancelAndClose: true,
      closeOnClickModal: false, type: 'warning'
    })
    if (!(await save())) return false
    if (isDirty.value) { ElMessage.warning('保存期间又有新的修改，请保存后再次离开'); return false }
    return true
  } catch (error) { return error === 'cancel' }
})
provide('workflow-execution', execution)
function selectExecutionNode(id: string) {
  workflow.value.nodes = workflow.value.nodes.map(node => ({ ...node, selected: node.id === id }))
  const node = workflow.value.nodes.find(n => n.id === id)
  if (node) onNodeClick(node)
}
function resizeMonitor(delta: number) {
  monitorHeight.value = Math.max(220, Math.min(maxMonitorHeight.value, monitorHeight.value + delta))
}
let stopMonitorResize: (() => void) | undefined
function startMonitorResize(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  stopMonitorResize?.()
  const startY = event.clientY
  const startHeight = monitorHeight.value
  const move = (e: PointerEvent) => { monitorHeight.value = Math.max(220, Math.min(maxMonitorHeight.value, startHeight + startY - e.clientY)) }
  const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); stopMonitorResize = undefined }
  stopMonitorResize = stop
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}
const publishPath = ref('')
const variablesInput = ref<Record<string, unknown>>({})
const parametersDialogOpen = shallowRef(false)
const runDialogOpen = shallowRef(false)
function applyParameters(fields: WorkflowVariable[]) { workflow.value.variables = fields; parametersDialogOpen.value = false }
let pendingRunRequest: { intent: string; id: string } | undefined
const isPublishPathValid = computed(() => {
  const trimmed = publishPath.value.trim()
  return trimmed.length > 0 && /^[a-zA-Z0-9_.~_-]+$/.test(trimmed)
})
let disposed = false

onMounted(async () => {
  window.addEventListener('resize', onViewportResize)
  try {
    apis.value = await apiApi.list()
    const id = route.params.id
    if (id) {
      workflow.value = await workflowApi.get(Number(id))
      workflow.value.edges = workflow.value.edges.map(edge => syncBranchEdge(edge, workflow.value.nodes))
      publishPath.value = workflow.value.publish_path || ''
      savedFingerprint.value = fingerprint.value
    }
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '加载数据失败'))
  }
})

async function save(): Promise<boolean> {
  saving.value = true
  const saved = fingerprint.value
  try {
    if (workflow.value.id) {
      await workflowApi.update(workflow.value.id, workflow.value)
    } else {
      const res = await workflowApi.create(workflow.value)
      workflow.value.id = res.data.id
    }
    savedFingerprint.value = saved
    ElMessage.success('保存成功')
    return true
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '保存失败'))
    return false
  } finally {
    saving.value = false
  }
}

function run() {
  if (running.value || execution.value?.status === 'running') return
  if (!checkWorkflow()) return
  runDialogOpen.value = true
}

async function executeRun(variables: Record<string, unknown>) {
  if (running.value || execution.value?.status === 'running') return
  if (!checkWorkflow()) return
  runDialogOpen.value = false
  variablesInput.value = variables
  running.value = true
  try {
    if (!(await save()) || !workflow.value.id) return
    const intent = JSON.stringify([workflow.value.id, fingerprint.value, variables])
    if (pendingRunRequest?.intent !== intent) pendingRunRequest = { intent, id: crypto.randomUUID() }
    const result = await workflowApi.execute(workflow.value.id, variables, pendingRunRequest.id)
    pendingRunRequest = undefined
    monitorExecution(result.executionId, workflow.value.id)
    ElMessage.success('运行已开始，请在下方查看实时状态')
  } catch (err) {
    if (err === 'cancel' || err === 'close' || (isRecord(err) && (err.action === 'cancel' || err.action === 'close'))) return
    const pending = responseData(err)
    if (typeof pending?.executionId === 'number' && workflow.value.id) {
      pendingRunRequest = undefined
      monitorExecution(pending.executionId, workflow.value.id, apiErrorMessage(err, '执行启动待确认，正在查询状态，请勿重复启动'))
    } else {
      if (isRecord(err) && isRecord(err.response) && typeof err.response.status === 'number' && err.response.status >= 400 && err.response.status < 500) pendingRunRequest = undefined
      ElMessage.error(apiErrorMessage(err, '运行失败'))
    }
  } finally {
    running.value = false
  }
}

async function publish() {
  if (!checkWorkflow()) return
  publishing.value = true
  try {
    if (!(await save()) || !workflow.value.id || !checkWorkflow()) return
    const updated = await workflowApi.publish(workflow.value.id, publishPath.value.trim())
    workflow.value.is_published = updated.is_published
    workflow.value.publish_path = updated.publish_path
    publishPath.value = updated.publish_path || ''
    ElMessage.success('发布成功')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '发布失败'))
  } finally {
    publishing.value = false
  }
}

async function unpublish() {
  if (!workflow.value.id) return
  publishing.value = true
  try {
    const updated = await workflowApi.unpublish(workflow.value.id)
    workflow.value.is_published = updated.is_published
    workflow.value.publish_path = updated.publish_path
    publishPath.value = ''
    ElMessage.success('已取消发布')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '取消发布失败'))
  } finally {
    publishing.value = false
  }
}

function onUpdateNode(node: TypedNode) {
  const index = workflow.value.nodes.findIndex((n) => n.id === node.id)
  if (index !== -1) {
    const previous = workflow.value.nodes[index]
    if (node.type === 'branch') {
      const before = configuredBranchIds(previous.data)
      const remaining = configuredBranchIds(node.data)
      workflow.value.edges = workflow.value.edges.filter(edge => {
        if (edge.source !== node.id) return true
        const id = edge.branchId || edge.sourceHandle || edge.label
        return !id || !before.has(id) || remaining.has(id)
      }).map(edge => syncBranchEdge(edge, workflow.value.nodes.map(item => item.id === node.id ? node : item)))
      if (selectedEdge.value) selectedEdge.value = workflow.value.edges.find(edge => edge.id === selectedEdge.value?.id) || null
    }
    workflow.value.nodes[index] = node
  }
}

function onNodeClick(clickedNode: Node) {
  const node = isTypedNode(clickedNode) ? clickedNode : null
  selectedNode.value = node
  selectedNodeId.value = node?.id ?? null
  selectedEdge.value = null
}

function onEdgeClick(edge: FlowEdge) {
  selectedEdge.value = edge
  selectedNode.value = null
  selectedNodeId.value = null
}

function onUpdateEdgeLabel() {
  if (!selectedEdge.value) return
  const index = workflow.value.edges.findIndex((e) => e.id === selectedEdge.value!.id)
  if (index !== -1) {
    workflow.value.edges[index] = { ...selectedEdge.value }
  }
}

function onUpdateEdgeBranch(event: Event) {
  if (!selectedEdge.value || !(event.target instanceof HTMLSelectElement)) return
  const branch = selectedEdgeBranches.value.find(branch => branch.id === (event.target as HTMLSelectElement).value)
  if (!branch) return
  selectedEdge.value = { ...selectedEdge.value, branchId: branch.id, sourceHandle: branch.id, label: branch.label }
  onUpdateEdgeLabel()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

onUnmounted(() => {
  window.removeEventListener('resize', onViewportResize)
  stopMonitorResize?.()
  disposed = true
})
</script>

<style scoped>
.workflow-editor { display: flex; flex-direction: column; height: 100dvh; min-width: 940px; overflow: hidden; }
.toolbar { height: 64px; flex-shrink: 0; padding: 0 24px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 20px; background: #fbfcff; }
.back-button { margin: 0; padding: 8px 10px; } .back-button svg { width: 16px; height: 16px; margin-right: 4px; }
.brand { display: flex; align-items: center; gap: 12px; border-right: 1px solid var(--line); padding-right: 28px; white-space: nowrap; } .brand svg { width: 27px; height: 27px; color: #1677ff; } .brand strong { font-size: 22px; letter-spacing: -.5px; } .workspace-label { color: #1677ff; font-size: 15px; font-weight: 600; }
.workflow-name { width: 200px; } .workflow-name :deep(.el-input__wrapper) { background: transparent; box-shadow: none; padding: 0 4px; } .workflow-name :deep(input) { font-size: 14px; font-weight: 600; color: #344056; } .workflow-name :deep(.el-input__wrapper:hover), .workflow-name :deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 1px #b4cdf3 inset; }
.save-state { display: inline-flex; align-items: center; gap: 6px; color: #526079; font-size: 13px; white-space: nowrap; } .save-state svg { color: #32a332; width: 18px; height: 18px; } .save-state.dirty { color: #9c7319; } .toolbar-actions { margin-left: auto; display: flex; gap: 10px; } .toolbar-actions .el-button { margin: 0; height: 36px; min-width: 82px; } .toolbar-actions svg { width: 16px; height: 16px; margin-right: 7px; }
.editor-body { display: flex; flex: 1; min-height: 0; overflow: hidden; } .canvas-workspace { min-width: 0; min-height: 0; flex: 1; display: flex; flex-direction: column; } .graph-workspace { flex: 1; min-height: 180px; display: flex; overflow: hidden; } .graph-workspace :deep(.flow-canvas) { height: auto; min-width: 0; } .canvas-workspace > :deep(.execution-panel) { flex-grow: 0; flex-shrink: 0; max-height: 60%; }
.monitor-divider { height: 12px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-block: 1px solid var(--line); background: #f7f9fe; cursor: row-resize; touch-action: none; } .monitor-divider svg { width: 34px; height: 16px; padding: 0 8px; border: 1px solid var(--line); border-radius: 6px; background: white; color: #8090a9; }
.edge-editor { display: flex; align-items: center; gap: 16px; padding: 8px 24px; border-bottom: 1px solid var(--line); font-size: 13px; } .publish-popover { display: grid; gap: 12px; } .publish-popover h3 { margin: 0; font-size: 16px; } .publish-popover p { margin: 0; color: #7a879b; font-size: 12px; } .publish-popover small { color: #526079; overflow-wrap: anywhere; }
@media (max-width: 1150px) { .toolbar { padding: 0 16px; gap: 14px; } .brand { padding-right: 16px; } .brand strong { font-size: 19px; } .workflow-name { width: 160px; } .workspace-label { display: none; } }
@media (max-width: 1400px) { .toolbar { gap: 10px; padding-inline: 14px; } .brand { padding-right: 12px; } .brand strong { display: none; } .workspace-label { display: none; } .toolbar-actions { gap: 6px; } .toolbar-actions .el-button { min-width: auto; } }
</style>
