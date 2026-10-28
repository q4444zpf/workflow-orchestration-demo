<template>
  <div class="node http-node">
    <Handle type="target" :position="Position.Left" />
    <div>HTTP API</div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
</script>

<style scoped>
.node { padding: 10px 16px; border-radius: 8px; border: 2px solid #909399; background: #fff; }
.http-node { border-color: #409eff; }
</style>
