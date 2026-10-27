<template>
  <div class="workflow-editor">
    <el-page-header title="流程编排" @back="$router.push('/apis')" />
    <div class="toolbar">
      <el-input v-model="workflow.name" placeholder="流程名称" style="width: 200px" />
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      <el-button :loading="running" @click="run">运行</el-button>
      <div class="publish-section">
        <el-input
          v-model="publishPath"
          placeholder="发布路径"
          style="width: 180px"
          :disabled="workflow.is_published"
        />
        <el-button
          v-if="!workflow.is_published"
          type="success"
          :loading="publishing"
          :disabled="!isPublishPathValid"
          @click="publish"
        >
          发布
        </el-button>
        <el-button
          v-else
          type="danger"
          :loading="publishing"
          @click="unpublish"
        >
          取消发布
        </el-button>
        <span v-if="workflow.is_published && workflow.publish_path" class="publish-status">
          已发布: /api/run/{{ workflow.publish_path }}
        </span>
      </div>
    </div>
    <div class="editor-body">
      <NodeLibrary :apis="apis" />
      <FlowCanvas
        v-model:nodes="workflow.nodes"
        v-model:edges="workflow.edges"
        @node-click="onNodeClick"
      />
      <PropertyPanel v-model:node="selectedNode" :apis="apis" @update:node="onUpdateNode" />
      <ExecutionPanel :execution="execution" :selected-node-id="selectedNodeId" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { Node } from '@vue-flow/core'
import { apiApi, workflowApi, executionApi } from '../api/index.js'
import NodeLibrary from '../components/NodeLibrary.vue'
import FlowCanvas from '../components/FlowCanvas.vue'
import PropertyPanel from '../components/PropertyPanel.vue'
import ExecutionPanel from '../components/ExecutionPanel.vue'
import type { Workflow, RegisteredApi, TypedNode, Execution, ExecutionLog, NodeExecutionState } from '../types/index.js'

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
const workflow = ref<Workflow>({ name: '新流程', nodes: [], edges: [] })
const apis = ref<RegisteredApi[]>([])
const selectedNode = ref<TypedNode | null>(null)
const selectedNodeId = ref<string | null>(null)
const saving = ref(false)
const running = ref(false)
const publishing = ref(false)
const execution = ref<Execution | null>(null)
const publishPath = ref('')
const isPublishPathValid = computed(() => {
  const trimmed = publishPath.value.trim()
  return trimmed.length > 0 && /^[a-zA-Z0-9_.~_-]+$/.test(trimmed)
})
let eventSource: EventSource | null = null

onMounted(async () => {
  try {
    apis.value = await apiApi.list()
    const id = route.params.id
    if (id) {
      workflow.value = await workflowApi.get(Number(id))
      publishPath.value = workflow.value.publish_path || ''
    }
  } catch (err) {
    ElMessage.error((err instanceof Error ? err.message : null) || '加载数据失败')
  }
})

async function save(): Promise<boolean> {
  saving.value = true
  try {
    if (workflow.value.id) {
      await workflowApi.update(workflow.value.id, workflow.value)
    } else {
      const res = await workflowApi.create(workflow.value)
      workflow.value.id = res.data.id
    }
    ElMessage.success('保存成功')
    return true
  } catch (err) {
    ElMessage.error((err instanceof Error ? err.message : null) || '保存失败')
    return false
  } finally {
    saving.value = false
  }
}

async function run() {
  running.value = true
  try {
    if (!workflow.value.id && !(await save())) return
    if (!workflow.value.id) return
    const result = await workflowApi.execute(workflow.value.id, {})
    execution.value = result
    if (result.executionId) {
      subscribeExecutionEvents(result.executionId)
    }
    ElMessage.success('运行成功')
  } catch (err) {
    ElMessage.error((err instanceof Error ? err.message : null) || '运行失败')
  } finally {
    running.value = false
  }
}

async function publish() {
  if (!workflow.value.id) {
    ElMessage.error('请先保存工作流')
    return
  }
  publishing.value = true
  try {
    const updated = await workflowApi.publish(workflow.value.id, publishPath.value.trim())
    workflow.value.is_published = updated.is_published
    workflow.value.publish_path = updated.publish_path
    publishPath.value = updated.publish_path || ''
    ElMessage.success('发布成功')
  } catch (err) {
    ElMessage.error((err instanceof Error ? err.message : null) || '发布失败')
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
    ElMessage.error((err instanceof Error ? err.message : null) || '取消发布失败')
  } finally {
    publishing.value = false
  }
}

function onUpdateNode(node: TypedNode) {
  const index = workflow.value.nodes.findIndex((n) => n.id === node.id)
  if (index !== -1) {
    workflow.value.nodes[index] = node
  }
}

function onNodeClick(event: { node: Node }) {
  const node = isTypedNode(event.node) ? event.node : null
  selectedNode.value = node
  selectedNodeId.value = node?.id ?? null
}

function subscribeExecutionEvents(executionId: number) {
  closeEventSource()
  eventSource = executionApi.events(executionId)
  eventSource.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data)
      if (event.type === 'connected') return
      applyExecutionEvent(event)
    } catch {
      console.warn('Received malformed SSE message:', message.data)
    }
  }
  eventSource.onerror = () => {
    closeEventSource()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isValidExecutionEvent(event: unknown): event is { type: string; nodeId: string; data: unknown } {
  if (!isRecord(event)) return false
  return typeof event.type === 'string' && typeof event.nodeId === 'string'
}

function applyExecutionEvent(event: unknown) {
  if (!execution.value) return
  if (!isValidExecutionEvent(event)) {
    console.warn('Ignoring invalid execution event:', event)
    return
  }
  if (event.type === 'log' && isRecord(event.data)) {
    execution.value.logs.push(event.data as unknown as ExecutionLog)
  } else if (event.type === 'state' && isRecord(event.data)) {
    if (!execution.value.context[event.nodeId]) {
      execution.value.context[event.nodeId] = event.data as unknown as NodeExecutionState
    } else {
      Object.assign(execution.value.context[event.nodeId], event.data)
    }
  }
}

function closeEventSource() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

onUnmounted(() => {
  closeEventSource()
})
</script>

<style scoped>
.workflow-editor { display: flex; flex-direction: column; height: 100vh; }
.toolbar { padding: 8px 16px; border-bottom: 1px solid #dcdfe6; display: flex; gap: 8px; align-items: center; }
.publish-section { margin-left: auto; display: flex; gap: 8px; align-items: center; }
.publish-status { color: #67c23a; font-size: 12px; }
.editor-body { flex: 1; display: flex; overflow: hidden; }
</style>
