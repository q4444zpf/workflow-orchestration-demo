<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { executionApi, workflowApi } from '../api'
import type { ExecutionSummary, WorkflowSummary } from '../types'
import { executionStatus, formatDuration, formatTime } from '../components/executionFormatting'
import ManagementShell from '../components/ManagementShell.vue'
import { readHistoryLocation, historyLocationQuery, executionDetailPath } from '../components/executionHistoryLocation'
const route = useRoute()
const router = useRouter()
const location = computed(() => readHistoryLocation(route.query))
const workflowId = computed({ get: () => location.value.workflowId, set: value => { void router.replace({ query: historyLocationQuery({ ...location.value, workflowId: value, page: 1 }) }) } })
const status = computed({ get: () => location.value.status, set: value => { void router.replace({ query: historyLocationQuery({ ...location.value, status: value, page: 1 }) }) } })
const page = computed({ get: () => location.value.page, set: value => { void router.replace({ query: historyLocationQuery({ ...location.value, page: value }) }) } })
const pageSize = 20
const total = ref(0)
const records = ref<ExecutionSummary[]>([])
const workflows = ref<WorkflowSummary[]>([])
const loading = ref(false)
const error = ref('')
let generation = 0
let disposed = false
async function load() {
  const current = ++generation
  loading.value = true; error.value = ''; records.value = []
  try {
    const result = await executionApi.list({ page: page.value, pageSize, workflowId: workflowId.value ? Number(workflowId.value) : undefined, status: status.value || undefined })
    if (disposed || current !== generation) return
    const maximum = Math.max(1, Math.ceil(result.total / pageSize))
    if (page.value > maximum) { page.value = maximum; return }
    records.value = result.items; total.value = result.total
  } catch {
    if (!disposed && current === generation) { error.value = '加载执行日志失败，请重试'; total.value = 0 }
  } finally { if (!disposed && current === generation) loading.value = false }
}
watch([workflowId, status, page], () => { void load() }, { immediate: true })
onMounted(async () => {
  try { const result = await workflowApi.list(); if (!disposed) workflows.value = result }
  catch { /* 执行日志查询独立于工作流下拉列表。 */ }
})
onBeforeUnmount(() => { disposed = true; generation++ })
</script>

<template>
  <ManagementShell active="executions">
  <main class="management-page">
    <router-link class="back-link" to="/workflows">← 返回工作流列表</router-link>
    <header class="management-header"><div><p class="eyebrow">运行记录</p><h1>工作流执行日志</h1><p class="page-description">查看历史执行，定位每次调用的输入、输出与异常。时间按本地时区显示。</p></div></header>
    <section class="management-card">
      <div class="filter-bar"><label>工作流 <select v-model="workflowId" aria-label="筛选工作流"><option value="">全部工作流</option><option v-if="workflowId && !workflows.some(item => String(item.id) === workflowId)" :value="workflowId">工作流 #{{ workflowId }}</option><option v-for="workflow in workflows" :key="workflow.id" :value="String(workflow.id)">{{ workflow.name }} · #{{ workflow.id }}</option></select></label><label>状态 <select v-model="status" aria-label="筛选执行状态"><option value="">全部状态</option><option value="running">执行中</option><option value="success">成功</option><option value="failed">失败</option><option value="stopped">已停止</option></select></label><button class="secondary-action" :disabled="loading" @click="load">刷新</button></div>
      <p class="saved-state-note">列表显示已保存状态，打开详情会同步最新执行状态。</p>
      <p v-if="error" role="alert" class="error-notice">{{ error }}</p>
      <p v-else-if="loading" role="status" class="empty-state">正在加载执行记录…</p>
      <div v-else class="table-scroll"><table class="management-table"><thead><tr><th>执行编号</th><th>工作流</th><th>状态</th><th>开始时间</th><th>结束时间</th><th>耗时</th><th>操作</th></tr></thead><tbody><tr v-for="record in records" :key="record.id"><td>#{{ record.id }}</td><td>{{ record.workflow_name || `工作流 #${record.workflow_id}` }}</td><td><span class="status-badge" :class="record.status">{{ executionStatus(record.status) }}</span><small v-if="record.start_state === 'pending'" class="row-description">启动待确认</small></td><td>{{ formatTime(record.started_at) }}</td><td>{{ formatTime(record.ended_at) }}</td><td>{{ formatDuration(record.started_at, record.ended_at, record.status === 'running') }}</td><td><router-link :to="executionDetailPath(record.id, location)">查看详情</router-link></td></tr></tbody></table><p v-if="!records.length" class="empty-state">暂无符合条件的执行记录</p></div>
      <footer class="pagination"><span>共 {{ total }} 条 · 第 {{ page }} / {{ Math.max(1, Math.ceil(total / pageSize)) }} 页</span><button class="secondary-action" aria-label="上一页" :disabled="loading || page <= 1" @click="page--">上一页</button><button class="secondary-action" aria-label="下一页" :disabled="loading || page * pageSize >= total" @click="page++">下一页</button></footer>
    </section>
  </main>
  </ManagementShell>
</template>
