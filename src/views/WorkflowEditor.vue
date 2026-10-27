<template>
  <div class="workflow-editor">
    <el-page-header title="流程编排" @back="$router.push('/apis')" />
    <div class="toolbar">
      <el-input v-model="workflow.name" placeholder="流程名称" style="width: 200px" />
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      <el-button :loading="running" @click="run">运行</el-button>
    </div>
    <div class="editor-body">
      <NodeLibrary :apis="apis" />
      <FlowCanvas
        v-model:nodes="workflow.nodes"
        v-model:edges="workflow.edges"
        @node-click="selectedNode = isTypedNode($event.node) ? $event.node : null"
      />
      <PropertyPanel v-model:node="selectedNode" :apis="apis" @update:node="onUpdateNode" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { Node } from '@vue-flow/core'
import { apiApi, workflowApi } from '../api/index.js'
import NodeLibrary from '../components/NodeLibrary.vue'
import FlowCanvas from '../components/FlowCanvas.vue'
import PropertyPanel from '../components/PropertyPanel.vue'
import type { Workflow, RegisteredApi, TypedNode } from '../types/index.js'

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
const saving = ref(false)
const running = ref(false)

onMounted(async () => {
  try {
    apis.value = await apiApi.list()
    const id = route.params.id
    if (id) {
      workflow.value = await workflowApi.get(Number(id))
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
    await workflowApi.execute(workflow.value.id, {})
    ElMessage.success('运行成功')
  } catch (err) {
    ElMessage.error((err instanceof Error ? err.message : null) || '运行失败')
  } finally {
    running.value = false
  }
}

function onUpdateNode(node: TypedNode) {
  const index = workflow.value.nodes.findIndex((n) => n.id === node.id)
  if (index !== -1) {
    workflow.value.nodes[index] = node
  }
}
</script>

<style scoped>
.workflow-editor { display: flex; flex-direction: column; height: 100vh; }
.toolbar { padding: 8px 16px; border-bottom: 1px solid #dcdfe6; display: flex; gap: 8px; }
.editor-body { flex: 1; display: flex; overflow: hidden; }
</style>
