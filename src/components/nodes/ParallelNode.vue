<template>
  <div class="node parallel-node">
    <Handle type="target" :position="Position.Left" />
    <div>并行</div>
    <Handle type="source" :position="Position.Right" id="out-1" />
    <Handle type="source" :position="Position.Bottom" id="out-2" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
</script>

<style scoped>
.node { padding: 10px 16px; border-radius: 8px; border: 2px solid #909399; background: #fff; }
.parallel-node { border-color: #909399; }
</style>
