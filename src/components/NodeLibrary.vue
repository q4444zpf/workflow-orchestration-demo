<template>
  <aside class="node-library" aria-label="节点库">
    <h2>节点库</h2>
    <p class="library-caption">点击或拖拽添加节点</p>
    <h3>基础节点</h3>
    <button v-for="(meta, type) in nodeCatalog" :key="type" type="button" class="node-item" :aria-label="`添加 ${meta.label} 节点`" draggable="true" @click="emit('add-node', type)" @dragstart="onDragStart($event, type)">
      <component :is="meta.icon" :style="{ color: meta.color }" /><span>{{ meta.label }}</span>
    </button>
    <div class="registered-heading"><h3>已注册 API</h3><router-link to="/apis" aria-label="管理 API"><Setting /></router-link></div>
    <button v-for="api in apis" :key="api.id" type="button" class="node-item api-item" :aria-label="`添加 API ${api.name}`" draggable="true" @click="emit('add-node', 'http', api)" @dragstart="onDragStart($event, 'http', api)"><Link /><span>{{ api.name }}</span></button>
    <p v-if="!apis.length" class="library-caption">暂无接口，<router-link to="/apis">去注册</router-link></p>
  </aside>
</template>
<script setup lang="ts">
import { Setting, Link } from '@element-plus/icons-vue'
import { nodeCatalog } from './nodePresentation'
import type { RegisteredApi } from '../types/index.js'
defineProps<{ apis: RegisteredApi[] }>()
const emit = defineEmits<{ 'add-node': [type: string, api?: RegisteredApi] }>()
function onDragStart(event: DragEvent, type: string, api?: RegisteredApi) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData('application/vueflow', JSON.stringify({ type, api }))
  event.dataTransfer.effectAllowed = 'move'
}
</script>
<style scoped>
.node-library { width: 180px; box-sizing: border-box; padding: 24px 14px; border-right: 1px solid var(--line); background: #fbfcff; overflow-y: auto; }
h2 { font-size: 19px; margin: 0 0 8px; } h3 { font-size: 13px; margin: 26px 0 12px; color: #526079; }
.library-caption { color: #7a879b; font-size: 12px; line-height: 1.7; } .node-item { display: flex; align-items: center; gap: 12px; padding: 12px; margin: 7px 0; background: #f1f4fa; border: 1px solid transparent; border-radius: 7px; cursor: grab; font-size: 14px; } .node-item:hover { border-color: #b3ceff; background: #ebf2ff; } .node-item svg { width: 20px; height: 20px; flex-shrink: 0; } .node-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .registered-heading { display: flex; align-items: center; justify-content: space-between; margin-top: 26px; } .registered-heading h3 { margin: 0; } .registered-heading svg { width: 17px; height: 17px; color: #7a879b; } .api-item { color: #1677ff; }
.node-item { width: 100%; color: #203049; text-align: left; }
.api-item { color: #1677ff; }
.node-item:focus-visible { outline: 2px solid #1677ff; outline-offset: 1px; background: #ebf2ff; }
</style>
