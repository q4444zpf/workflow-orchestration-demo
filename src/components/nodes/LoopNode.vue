<template>
  <div class="node loop-node">
    <Handle type="target" :position="Position.Top" />
    <div>循环</div>
    <Handle type="source" :position="Position.Bottom" id="body" />
    <Handle type="source" :position="Position.Right" id="exit" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
</script>

<style scoped>
.node { padding: 10px 16px; border-radius: 8px; border: 2px solid #909399; background: #fff; }
.loop-node { border-color: #909399; }
</style>
