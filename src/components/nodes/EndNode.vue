<template>
  <div class="node end-node">
    <Handle type="target" :position="Position.Left" />
    <div>结束</div>
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
</script>

<style scoped>
.node { padding: 10px 16px; border-radius: 8px; border: 2px solid #909399; background: #fff; }
.end-node { border-color: #f56c6c; }
</style>
