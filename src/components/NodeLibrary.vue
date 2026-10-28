<template>
  <div class="node-library">
    <h4>基础节点</h4>
    <div class="node-item" draggable="true" @dragstart="onDragStart($event, 'start')">开始</div>
    <div class="node-item" draggable="true" @dragstart="onDragStart($event, 'end')">结束</div>
    <div class="node-item" draggable="true" @dragstart="onDragStart($event, 'http')">HTTP API</div>
    <div class="node-item" draggable="true" @dragstart="onDragStart($event, 'python')">Python</div>
    <div class="node-item" draggable="true" @dragstart="onDragStart($event, 'branch')">分支</div>
    <div class="node-item" draggable="true" @dragstart="onDragStart($event, 'loop')">循环</div>
    <div class="node-item" draggable="true" @dragstart="onDragStart($event, 'parallel')">并行</div>

    <h4>已注册 API</h4>
    <div
      v-for="api in apis"
      :key="api.id"
      class="node-item api-item"
      draggable="true"
      @dragstart="onDragStart($event, 'http', api)"
    >
      {{ api.name }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { RegisteredApi } from '../types/index.js'

defineProps<{ apis: RegisteredApi[] }>()

function onDragStart(event: DragEvent, type: string, api?: RegisteredApi) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData('application/vueflow', JSON.stringify({ type, api }))
  event.dataTransfer.effectAllowed = 'move'
}
</script>

<style scoped>
.node-library { width: 180px; padding: 12px; border-right: 1px solid #dcdfe6; }
.node-item { padding: 8px; margin: 4px 0; background: #f5f7fa; border-radius: 4px; cursor: grab; }
.api-item { background: #ecf5ff; }
</style>
