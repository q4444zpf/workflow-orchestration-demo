<template>
  <div ref="canvasElement" class="flow-canvas" @drop="onDrop" @dragover="onDragOver">
    <VueFlow
      v-model:nodes="localNodes"
      v-model:edges="displayEdges"
      :node-types="nodeTypes"
      :default-edge-options="defaultEdgeOptions"
      :auto-connect="true"
      :delete-key-code="null"
      @nodes-initialized="scheduleFit"
      @node-click="onNodeClick"
      @edge-click="onEdgeClick"
    >
      <Background />
      <Controls :show-zoom="false" :show-fit-view="false" :show-interactive="false">
        <button class="canvas-control" aria-label="适应画布" title="适应画布" @click="fitView?.({ padding: 0.15, maxZoom: 1 })"><FullScreen /></button>
        <button class="canvas-control" aria-label="缩小画布" title="缩小" @click="zoomOut?.()"><Minus /></button>
        <span class="zoom-label">{{ zoomPercent }}%</span>
        <button class="canvas-control" aria-label="放大画布" title="放大" @click="zoomIn?.()"><Plus /></button>
        <button type="button" class="canvas-control connection-control" aria-label="添加连线" aria-haspopup="dialog" :disabled="localNodes.length < 2" @click="connectionOpen = true"><Link />连线</button>
      </Controls>
    </VueFlow>
    <FlowConnectionDialog v-if="connectionOpen" :nodes="localNodes" :edges="localEdges" @connect="connectFromDialog" @close="connectionOpen = false" />
    <span class="canvas-announcement" role="status">{{ announcement }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, shallowRef, watch, markRaw, ref, onMounted, onBeforeUnmount } from 'vue'
import { VueFlow, useVueFlow, MarkerType } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { FullScreen, Minus, Plus, Link } from '@element-plus/icons-vue'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import type { Connection, Node, Edge, NodeTypesObject, NodeComponent, NodeMouseEvent, EdgeMouseEvent } from '@vue-flow/core'
import type { Execution, RegisteredApi } from '../types/index.js'
import WorkflowNode from './nodes/WorkflowNode.vue'
import FlowConnectionDialog from './FlowConnectionDialog.vue'
import { nodeMeta } from './nodePresentation'
import { syncBranchEdge } from './branchEdges'
import { getBranchDefinitions } from '../../server/src/shared/branches'
import type { FlowEdge } from '../types/index.js'

const props = defineProps<{ nodes: Node[]; edges: Edge[]; execution?: Execution | null }>()
const emit = defineEmits(['update:nodes', 'update:edges', 'node-click', 'edge-click', 'delete-nodes'])

const nodeTypes: NodeTypesObject = Object.fromEntries(['start', 'end', 'http', 'python', 'branch', 'loop', 'parallel'].map(type => [type, markRaw(WorkflowNode) as NodeComponent]))
const defaultEdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, color: '#8a98ae', width: 18, height: 18 }
}

const localNodes = shallowRef<Node[]>(props.nodes)
const localEdges = shallowRef<Edge[]>(props.edges)
const { screenToFlowCoordinate, fitView, zoomIn, zoomOut, viewport, getSelectedNodes, getSelectedEdges, addEdges, removeEdges, findNode, updateNodeData } = useVueFlow()
const connectionOpen = shallowRef(false)
const announcement = shallowRef('')
function connectFromDialog(connection: Connection & Pick<Edge, 'label'>) {
  const count = localEdges.value.length + 1
  addEdges({ ...connection, id: newGraphId() })
  connectionOpen.value = false
  announcement.value = `已添加连线，画布共 ${count} 条连线`
}
function requestKeyboardDelete(event: KeyboardEvent) {
  if (!['Delete', 'Backspace'].includes(event.key) || event.repeat || event.defaultPrevented) return
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], .monaco-editor, .el-message-box')) return
  const selected = (getSelectedNodes?.value || []).filter(node => node.deletable !== false)
  if (selected.length) {
    event.preventDefault()
    emit('delete-nodes', selected.map(node => node.id))
  } else if (getSelectedEdges?.value.length) {
    event.preventDefault()
    removeEdges(getSelectedEdges.value)
  }
}
const zoomPercent = computed(() => Math.round((viewport?.value.zoom || 1) * 100))
const canvasElement = ref<HTMLElement>()
let resizeObserver: ResizeObserver | undefined
let fitFrame = 0
function scheduleFit() {
  cancelAnimationFrame(fitFrame)
  // 少量节点保持原始尺寸，避免自动适应将节点和文字放大到 200%。
  fitFrame = requestAnimationFrame(() => { if (props.nodes.length && fitView) fitView({ padding: 0.15, maxZoom: 1, duration: 150 }) })
}
onMounted(() => {
  window.addEventListener('keydown', requestKeyboardDelete)
  if (typeof ResizeObserver === 'undefined' || !canvasElement.value) return
  resizeObserver = new ResizeObserver(scheduleFit)
  resizeObserver.observe(canvasElement.value)
})
onBeforeUnmount(() => { window.removeEventListener('keydown', requestKeyboardDelete); resizeObserver?.disconnect(); cancelAnimationFrame(fitFrame) })
watch(() => props.nodes.length, scheduleFit)
const displayEdges = computed({
  get: () => localEdges.value.map(edge => {
    const source = props.execution?.context[edge.source]
    const target = props.execution?.context[edge.target]
    const sourceNode = props.nodes.find(node => node.id === edge.source)
    const selectedBranch = typeof source?.output === 'boolean' ? String(source.output) : source?.output?.branchId ?? source?.output
    const usedBranch = sourceNode?.type !== 'branch' || (edge as FlowEdge).branchId === selectedBranch || edge.sourceHandle === selectedBranch || edge.label === selectedBranch
    const state = target && source?.status === 'success' && usedBranch ? 'run-edge-success' : props.execution ? 'run-edge-idle' : ''
    return { ...syncBranchEdge(edge, props.nodes), class: [edge.class, state].filter(Boolean).join(' ') }
  }),
  set: (edges: Edge[]) => { localEdges.value = edges.map(edge => ({ ...syncBranchEdge(edge, props.nodes), class: typeof edge.class === 'string' ? edge.class.replace(/run-edge-(success|idle)/g, '').trim() : edge.class })) }
})

watch(() => props.nodes, (nodes) => {
  localNodes.value = nodes
  // 双向绑定可能复用同一数组；替换其中的节点时，Vue Flow 不会重新读取 data。
  for (const node of nodes) {
    const rendered = findNode(node.id)
    if (rendered && rendered.data !== node.data) updateNodeData(node.id, node.data || {}, { replace: true })
  }
}, { deep: true })
watch(() => props.edges, (v) => { localEdges.value = v }, { deep: true })
watch(localNodes, (v) => emit('update:nodes', v), { deep: true })
watch(localEdges, (v) => emit('update:edges', v), { deep: true })

function onDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  const data = event.dataTransfer?.getData('application/vueflow')
  if (!data) return

  let payload: { type: string; api?: RegisteredApi }
  try {
    payload = JSON.parse(data)
  } catch {
    return
  }

  const { type, api } = payload
  if (!type) return

  const position = screenToFlowCoordinate({
    x: event.clientX,
    y: event.clientY
  })
  addNode(type, position, api)
}

function newGraphId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function initialNodeData(type: string, api?: RegisteredApi) {
  if (api) return { ...api, apiId: api.id, label: api.name }
  if (type === 'branch') return { label: type, branches: getBranchDefinitions({ condition: 'false' }) }
  if (type === 'python') return { label: type, code: '# 在输入配置中定义变量后，可直接在此引用\nOUTPUT = None', inputMapping: {}, outputVar: 'OUTPUT', outputMapping: { result: 'OUTPUT' } }
  return type === 'http' ? { label: type, method: 'GET' } : { label: type }
}

function addNode(type: string, position: Node['position'], api?: RegisteredApi) {
  localNodes.value = [...localNodes.value, { id: newGraphId(), type, position, data: initialNodeData(type, api) }]
}

function addNodeFromLibrary(type: string, api?: RegisteredApi) {
  const rect = canvasElement.value?.getBoundingClientRect()
  if (!rect) return
  const center = screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  const position = { x: center.x - 58, y: center.y - 24 }
  const width = type === 'branch' ? 220 : Math.max(116, (api?.name.length || 0) * 14 + 52)
  const height = type === 'branch' ? 80 : 48
  const occupied = localNodes.value.map(node => {
    const dimensions = findNode(node.id)?.dimensions
    return { ...node.position, width: dimensions?.width || 116, height: dimensions?.height || 48 }
  })
  while (occupied.some(node => position.x < node.x + node.width + 16 && position.x + width + 16 > node.x
    && position.y < node.y + node.height + 16 && position.y + height + 16 > node.y)) position.y += height + 24
  addNode(type, position, api)
  announcement.value = `已添加${api?.name || nodeMeta(type).label}节点，画布共 ${localNodes.value.length} 个节点`
}
defineExpose({ addNodeFromLibrary })

function onNodeClick(event: NodeMouseEvent) {
  emit('node-click', event.node)
}

function onEdgeClick(event: EdgeMouseEvent) {
  emit('edge-click', event.edge)
}
</script>

<style scoped>
.flow-canvas { flex: 1; height: 100%; background: #fcfdff; }
:deep(.vue-flow__edge-path) { stroke: #b9c3d2; stroke-width: 1.5; }
:deep(.run-edge-success .vue-flow__edge-path) { stroke: #42aa35; stroke-width: 2; }
:deep(.run-edge-idle .vue-flow__edge-path) { stroke: #c7cfdd; stroke-dasharray: 5 4; }
:deep(.vue-flow__edge-text) { font-size: 12px; fill: #526079; }
:deep(.vue-flow__controls) { box-shadow: none; border: 1px solid #dfe5ee; border-radius: 6px; overflow: hidden; }
:deep(.vue-flow__controls-button) { width: 30px; height: 30px; color: #526079; }
:deep(.vue-flow__controls) { display: flex; flex-direction: row; align-items: center; background: white; padding: 2px; }
.canvas-control { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: white; color: #526079; border: 0; border-radius: 4px; }
.canvas-control:hover { background: #edf3ff; color: #1677ff; }
.canvas-control:focus-visible { outline: 2px solid #1677ff; outline-offset: -2px; }
.connection-control { width: auto; gap: 5px; padding: 0 8px; font-size: 12px; }
.connection-control:disabled { color: #8693a7; background: #fff; }
.canvas-announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.canvas-control svg { width: 16px; height: 16px; }
.zoom-label { padding: 0 5px; min-width: 42px; text-align: center; font-size: 12px; color: #526079; }
</style>
