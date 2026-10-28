<template>
  <div class="node branch-node">
    <Handle type="target" :position="Position.Left" />
    <div>分支</div>
    <Handle type="source" :position="Position.Right" id="true" />
    <Handle type="source" :position="Position.Bottom" id="false" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
</script>

<style scoped>
.node { padding: 10px 16px; border-radius: 8px; border: 2px solid #909399; background: #fff; }
.branch-node { border-color: #909399; }
</style>
