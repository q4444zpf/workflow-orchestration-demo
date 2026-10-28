<template>
  <div class="node python-node">
    <Handle type="target" :position="Position.Left" />
    <div>Python</div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
</script>

<style scoped>
.node { padding: 10px 16px; border-radius: 8px; border: 2px solid #909399; background: #fff; }
.python-node { border-color: #e6a23c; }
</style>
