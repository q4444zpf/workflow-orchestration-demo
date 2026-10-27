<template>
  <div class="execution-panel">
    <h4>执行监控</h4>
    <div v-if="!execution">点击运行开始</div>
    <div v-else>
      <p>状态：{{ execution.status }}</p>
      <el-timeline>
        <el-timeline-item
          v-for="(log, index) in execution.logs"
          :key="log.time + '-' + index"
          :type="log.level === 'error' ? 'danger' : 'primary'"
        >
          <p>{{ log.nodeId }} - {{ log.message }}</p>
          <p class="time">{{ log.time }}</p>
        </el-timeline-item>
      </el-timeline>
      <div v-if="selectedNodeId">
        <h5>节点：{{ selectedNodeId }}</h5>
        <pre>Input: {{ JSON.stringify(execution.context[selectedNodeId]?.input, null, 2) }}</pre>
        <pre>Output: {{ JSON.stringify(execution.context[selectedNodeId]?.output, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Execution } from '../types/index.js'

defineProps<{ execution: Execution | null; selectedNodeId: string | null }>()
</script>

<style scoped>
.execution-panel { width: 320px; padding: 12px; border-left: 1px solid #dcdfe6; overflow-y: auto; }
.time { font-size: 12px; color: #909399; }
pre { background: #f5f7fa; padding: 8px; border-radius: 4px; }
</style>
