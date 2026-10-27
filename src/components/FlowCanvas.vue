<template>
  <div class="flow-canvas" @drop="onDrop" @dragover="onDragOver">
    <VueFlow
      v-model:nodes="localNodes"
      v-model:edges="localEdges"
      :node-types="nodeTypes"
      fit-view-on-init
      @node-click="onNodeClick"
    >
      <Background />
      <Controls />
    </VueFlow>
  </div>
</template>

<script setup lang="ts">
import { shallowRef, watch, markRaw } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import type { Node, Edge, NodeTypesObject, NodeComponent, NodeMouseEvent } from '@vue-flow/core'
import type { RegisteredApi } from '../types/index.js'
import StartNode from './nodes/StartNode.vue'
import EndNode from './nodes/EndNode.vue'
import HttpNode from './nodes/HttpNode.vue'
import PythonNode from './nodes/PythonNode.vue'
import BranchNode from './nodes/BranchNode.vue'
import LoopNode from './nodes/LoopNode.vue'
import ParallelNode from './nodes/ParallelNode.vue'

const props = defineProps<{ nodes: Node[]; edges: Edge[] }>()
const emit = defineEmits(['update:nodes', 'update:edges', 'node-click'])

const nodeTypes: NodeTypesObject = {
  start: markRaw(StartNode) as NodeComponent,
  end: markRaw(EndNode) as NodeComponent,
  http: markRaw(HttpNode) as NodeComponent,
  python: markRaw(PythonNode) as NodeComponent,
  branch: markRaw(BranchNode) as NodeComponent,
  loop: markRaw(LoopNode) as NodeComponent,
  parallel: markRaw(ParallelNode) as NodeComponent
}

const localNodes = shallowRef<Node[]>(props.nodes)
const localEdges = shallowRef<Edge[]>(props.edges)
const { screenToFlowCoordinate } = useVueFlow()

watch(() => props.nodes, (v) => { localNodes.value = v }, { deep: true })
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

  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`

  const node: Node = {
    id,
    type,
    position,
    data: api ? { ...api, label: api.name ?? type } : { label: type }
  }

  localNodes.value.push(node)
}

function onNodeClick(event: NodeMouseEvent) {
  emit('node-click', event.node)
}
</script>

<style scoped>
.flow-canvas { flex: 1; height: 100%; }
</style>
