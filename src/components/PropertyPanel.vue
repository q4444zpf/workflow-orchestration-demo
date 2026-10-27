<template>
  <div class="property-panel">
    <h4>属性面板</h4>
    <div v-if="node">
      <p>ID: {{ node.id }}</p>
      <p>Type: {{ node.type }}</p>
      <p>Label: {{ node.data?.label }}</p>
    </div>
    <div v-else>
      <p>请选择一个节点</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RegisteredApi } from '../../server/src/types/index.js'

defineProps<{ node: any; apis: RegisteredApi[] }>()
defineEmits(['update:node'])
</script>

<style scoped>
.property-panel { width: 240px; padding: 12px; border-left: 1px solid #dcdfe6; }
</style>
