<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useExecutionRecord } from '../composables/useExecutionRecord'
import ExecutionNodeDetails from '../components/ExecutionNodeDetails.vue'
import ManagementShell from '../components/ManagementShell.vue'
import { readHistoryLocation, historyLocationPath } from '../components/executionHistoryLocation'
import { executionStatus, formatData, formatDuration, formatTime } from '../components/executionFormatting'
const route = useRoute()
const { execution, loading, error, reload } = useExecutionRecord(() => String(route.params.id))
const title = computed(() => execution.value?.workflow_snapshot?.name || `工作流 #${execution.value?.workflow_id || ''}`)
const backPath = computed(() => ['workflowId', 'status', 'page'].some(key => route.query[key] !== undefined)
  ? historyLocationPath(readHistoryLocation(route.query))
  : execution.value ? `/executions?workflowId=${execution.value.workflow_id}` : '/executions')
const names = computed(() => Object.fromEntries((execution.value?.workflow_snapshot?.nodes || []).map(node => [node.id, typeof node.data.label === 'string' ? node.data.label : node.id])))
const tabs = [
  { id: 'nodes', label: '节点记录' }, { id: 'input', label: '运行输入' },
  { id: 'output', label: '最终输出' }, { id: 'logs', label: '事件日志' }
]
const activeTab = ref('nodes')
watch(() => route.params.id, () => { activeTab.value = 'nodes' })
function changeTabByKey(event: KeyboardEvent, index: number) {
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
  else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.length - 1
  else return
  event.preventDefault()
  activeTab.value = tabs[next].id
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus()
}
</script>

<template>
  <ManagementShell active="executions" bounded>
    <main class="management-page execution-detail-page">
      <div class="detail-topline"><router-link :to="backPath">← 返回执行日志</router-link><span>执行详情 #{{ route.params.id }}</span></div>
      <header class="detail-heading"><h1 :title="title">{{ execution ? title : '工作流执行详情' }}</h1><div class="page-actions"><router-link v-if="execution" :to="`/editor/${execution.workflow_id}`">打开工作流</router-link><button class="secondary-action" aria-label="重新加载执行详情" :disabled="loading" @click="reload">刷新</button></div></header>
      <p v-if="error" class="error-notice detail-notice" role="alert">{{ error }}</p>
      <p v-if="loading" class="management-card empty-state" role="status">正在加载执行详情…</p>
      <template v-if="execution">
        <p v-if="execution.sync_warning" class="warning-notice detail-notice" role="status">{{ execution.sync_warning }}</p>
        <section class="detail-summary" aria-label="执行摘要"><span class="status-badge" :class="execution.status">{{ executionStatus(execution.status) }}</span><span v-if="execution.start_state === 'pending'" class="muted">启动待确认</span><dl><div><dt>开始</dt><dd>{{ formatTime(execution.started_at) }}</dd></div><div><dt>结束</dt><dd>{{ formatTime(execution.ended_at) }}</dd></div><div><dt>耗时</dt><dd>{{ formatDuration(execution.started_at, execution.ended_at, execution.status === 'running') }}</dd></div><div><dt>工作流</dt><dd>#{{ execution.workflow_id }}</dd></div></dl></section>
        <div v-if="execution.error" class="error-notice detail-notice workflow-error"><strong>工作流异常</strong><pre tabindex="0" aria-label="工作流异常内容">{{ execution.error }}</pre></div>
        <nav class="detail-tabs" role="tablist" aria-label="执行详情内容"><button v-for="(tab, index) in tabs" :id="`detail-tab-${tab.id}`" :key="tab.id" role="tab" :aria-selected="activeTab === tab.id" :aria-controls="`detail-panel-${tab.id}`" :tabindex="activeTab === tab.id ? 0 : -1" @click="activeTab = tab.id" @keydown="changeTabByKey($event, index)">{{ tab.label }}<span v-if="tab.id === 'nodes'">{{ execution.nodeRuns?.length || Object.keys(execution.context).length }}</span><span v-if="tab.id === 'logs'">{{ execution.logs.length }}</span></button></nav>
        <section v-show="activeTab === 'nodes'" id="detail-panel-nodes" class="detail-panel nodes-panel" role="tabpanel" aria-labelledby="detail-tab-nodes"><ExecutionNodeDetails :execution="execution" /></section>
        <section v-if="activeTab === 'input'" id="detail-panel-input" class="detail-panel full-value-panel" role="tabpanel" aria-labelledby="detail-tab-input"><h2>运行输入</h2><pre tabindex="0" aria-label="运行输入数据" data-testid="execution-input">{{ execution.input === undefined ? '此历史记录未保存运行输入' : formatData(execution.input) }}</pre></section>
        <section v-if="activeTab === 'output'" id="detail-panel-output" class="detail-panel full-value-panel" role="tabpanel" aria-labelledby="detail-tab-output"><h2>最终输出</h2><pre tabindex="0" aria-label="最终输出数据" data-testid="execution-output">{{ execution.status === 'running' ? '执行中，等待最终输出' : formatData(execution.result) }}</pre></section>
        <section v-if="activeTab === 'logs'" id="detail-panel-logs" class="detail-panel detail-events" role="tabpanel" aria-labelledby="detail-tab-logs"><h2>运行事件日志 <small>时间按本地时区显示</small></h2><div class="detail-events-scroll" tabindex="0" aria-label="运行事件日志内容"><p v-if="!execution.logs.length" class="empty-state">暂无事件日志</p><div v-for="(log, index) in execution.logs" :key="index" class="event-row" :class="{ 'event-error': log.level === 'error' }"><time>{{ formatTime(log.time) }}</time><strong>{{ names[log.nodeId] || log.nodeId || '系统' }}</strong><pre>{{ log.message }}</pre></div></div></section>
      </template>
    </main>
  </ManagementShell>
</template>

<style scoped>
.execution-detail-page { display: flex; flex-direction: column; gap: 16px; overflow: auto; }
.detail-topline { display: flex; align-items: center; gap: 18px; flex-shrink: 0; font-size: 13px; }
.detail-topline span { color: #6b7890; }
.detail-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-shrink: 0; }
.detail-heading h1 { min-width: 0; margin: 0; font-size: 24px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail-heading .page-actions { flex-shrink: 0; font-size: 14px; }
.detail-summary { display: flex; align-items: center; gap: 18px; background: white; border: 1px solid var(--line); border-radius: 8px; padding: 14px 18px; flex-shrink: 0; }
.detail-summary dl { display: flex; align-items: center; flex-wrap: wrap; gap: 14px 24px; margin: 0; }
.detail-summary dl div { display: flex; gap: 8px; font-size: 13px; }
.detail-summary dt { color: #6b7890; }
.detail-summary dd { margin: 0; overflow-wrap: anywhere; }
.detail-notice { margin: 0; flex-shrink: 0; max-height: 100px; overflow: auto; }
.workflow-error { display: flex; align-items: flex-start; gap: 16px; padding: 10px 14px; }
.workflow-error strong { flex-shrink: 0; }
.workflow-error pre { margin: 0; }
.detail-tabs { display: flex; flex-shrink: 0; gap: 28px; border-bottom: 1px solid var(--line); }
.detail-tabs button { display: flex; align-items: center; gap: 7px; padding: 0 0 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #53627a; font-size: 14px; white-space: nowrap; }
.detail-tabs button[aria-selected="true"] { color: #1677ff; border-bottom-color: #1677ff; font-weight: 600; }
.detail-tabs button span { font-size: 12px; font-weight: 400; color: #6b7890; }
.detail-panel { flex: 1 0 260px; min-height: 260px; display: flex; flex-direction: column; overflow: hidden; }
.full-value-panel, .detail-events { border: 1px solid var(--line); border-radius: 8px; background: white; }
.full-value-panel h2, .detail-events h2 { flex-shrink: 0; padding: 14px 18px; margin: 0; font-size: 14px; border-bottom: 1px solid var(--line); }
.full-value-panel pre { flex: 1; min-height: 0; margin: 0; padding: 18px; overflow: auto; font: 13px/1.7 Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.detail-events h2 small { color: #6b7890; font-size: 12px; font-weight: 400; margin-left: 12px; }
.detail-events-scroll { flex: 1; min-height: 0; overflow: auto; }
@media(max-width: 850px), (max-height: 600px) {
  .execution-detail-page { overflow: visible; }
  .detail-panel { flex: none; min-height: 0; overflow: visible; }
  .full-value-panel pre, .detail-events-scroll { max-height: 480px; flex: auto; }
  .detail-summary { align-items: flex-start; flex-wrap: wrap; gap: 12px; }
}
@media(max-width: 600px) {
  .detail-heading { align-items: flex-start; flex-wrap: wrap; gap: 12px; }
  .detail-heading h1 { width: 100%; white-space: normal; font-size: 21px; }
  .detail-summary dl { gap: 10px; flex-direction: column; align-items: flex-start; }
  .detail-tabs { gap: 18px; overflow-x: auto; padding: 3px 0; }
  .detail-tabs button { font-size: 13px; }
  .workflow-error { display: block; }
}
</style>
