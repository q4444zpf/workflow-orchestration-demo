<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Execution, NodeExecutionState } from '../types'
import { executionStatus, formatData, formatDuration, formatTime } from './executionFormatting'
const props = defineProps<{ execution: Execution }>()
const names = computed(() => Object.fromEntries((props.execution.workflow_snapshot?.nodes || []).map(node => [node.id, typeof node.data.label === 'string' ? node.data.label : node.id])))
interface Row { key: string; nodeId: string; invocationId?: string; scopePath?: string; attempt?: number; state: NodeExecutionState }
const rows = computed<Row[]>(() => props.execution.nodeRuns?.length
  ? props.execution.nodeRuns.map(run => ({ key: JSON.stringify([run.invocationId, run.attempt]), nodeId: run.nodeId, invocationId: run.invocationId, scopePath: run.scopePath, attempt: run.attempt, state: run }))
  : Object.entries(props.execution.context).map(([nodeId, state]) => ({ key: nodeId, nodeId, state })))
const selected = ref('')
watch(() => props.execution.id, () => { selected.value = '' })
const current = computed(() => rows.value.find(row => row.key === selected.value) || rows.value[0])
</script>

<template>
  <section class="management-card node-history"><div class="section-heading"><h2>节点执行记录</h2><span class="muted">{{ rows.length }} 次尝试 · 循环与重试分别记录</span></div>
    <p v-if="!rows.length" class="empty-state">暂无节点执行记录</p>
    <div v-else class="node-history-grid"><div class="history-node-list" aria-label="节点调用列表"><button v-for="row in rows" :key="row.key" class="history-node-row" :data-run-key="row.key" :aria-pressed="current?.key === row.key" @click="selected = row.key"><span class="node-row-heading"><strong :title="names[row.nodeId] || row.nodeId">{{ names[row.nodeId] || row.nodeId }}</strong><span class="status-badge" :class="row.state.status">{{ executionStatus(row.state.status) }}</span></span><small class="node-identity"><span class="node-id" :title="row.nodeId">{{ row.nodeId }}</span><span v-if="row.attempt" class="node-attempt">第 {{ row.attempt }} 次尝试</span></small><small class="node-row-footer"><span :title="row.scopePath">{{ row.scopePath || '历史调用' }}</span><span>{{ formatDuration(row.state.startedAt, row.state.endedAt, row.state.status === 'running') }}</span></small></button></div>
      <div v-if="current" class="history-node-content"><h3 class="current-node-title">{{ names[current.nodeId] || current.nodeId }}</h3><dl class="record-metadata"><div><dt>开始时间</dt><dd>{{ formatTime(current.state.startedAt) }}</dd></div><div><dt>结束时间</dt><dd>{{ formatTime(current.state.endedAt) }}</dd></div><div><dt>耗时</dt><dd>{{ formatDuration(current.state.startedAt, current.state.endedAt, current.state.status === 'running') }}</dd></div><div v-if="current.invocationId"><dt>调用 ID</dt><dd>{{ current.invocationId }}</dd></div></dl><div v-if="current.state.error" class="error-notice" tabindex="0" role="region" aria-label="节点异常内容"><strong>节点异常</strong><pre data-testid="history-node-error">{{ current.state.error }}</pre></div><div class="value-columns"><section class="value-box"><h3>节点输入</h3><pre tabindex="0" aria-label="节点输入数据" data-testid="history-node-input">{{ formatData(current.state.input) }}</pre></section><section class="value-box"><h3>节点输出</h3><pre tabindex="0" aria-label="节点输出数据" data-testid="history-node-output">{{ formatData(current.state.output) }}</pre></section></div></div>
    </div>
  </section>
</template>

<style scoped>
.node-history { display: flex; flex-direction: column; flex: 1; min-height: 0; margin: 0; }
.node-history .section-heading { padding: 12px 16px; flex-shrink: 0; }
.node-history .section-heading h2 { font-size: 14px; }
.node-history .section-heading .muted { font-size: 12px; }
.node-history-grid { display: grid; grid-template-columns: 250px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); flex: 1; min-height: 0; overflow: hidden; border-top: 1px solid var(--line); }
.history-node-list { min-height: 0; overflow: auto; border-right: 1px solid var(--line); }
.history-node-row { display: grid; gap: 5px; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); border-left: 3px solid transparent; background: white; padding: 11px 14px; color: inherit; }
.history-node-row[aria-pressed="true"] { background: #edf4ff; border-left-color: var(--blue); }
.node-row-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.node-row-heading strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.history-node-row small { color: #66758c; font-size: 12px; }
.node-identity { display: flex; gap: 8px; min-width: 0; }
.node-id { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-attempt { flex-shrink: 0; }
.node-row-footer { display: flex; justify-content: space-between; gap: 12px; }
.node-row-footer span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-row-footer span:last-child { flex-shrink: 0; }
.history-node-content { display: flex; flex-direction: column; gap: 14px; padding: 16px; min-width: 0; min-height: 0; overflow: auto; }
.current-node-title { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
.history-node-content .record-metadata { gap: 12px; padding: 0; flex-shrink: 0; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.history-node-content .record-metadata dd { font-size: 12px; }
.history-node-content .record-metadata dt { margin-bottom: 5px; }
.history-node-content .error-notice { margin: 0; max-height: 110px; overflow: auto; flex-shrink: 0; }
.history-node-content .value-columns { flex: 1; min-height: 120px; grid-template-rows: minmax(0, 1fr); gap: 16px; }
.history-node-content .value-box { display: flex; flex-direction: column; min-height: 0; }
.history-node-content .value-box h3 { flex-shrink: 0; }
.history-node-content .value-box pre { flex: 1; min-height: 0; max-height: none; overflow: auto; padding: 14px; }
@media(max-width: 1100px) { .node-history-grid { grid-template-columns: 220px minmax(0, 1fr); } .history-node-content .record-metadata { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media(max-width: 850px), (max-height: 600px) {
  .node-history-grid { grid-template-rows: auto; overflow: visible; }
  .history-node-content { overflow: visible; }
  .history-node-content .value-columns { min-height: 200px; grid-template-rows: auto; }
  .history-node-content .value-box pre { max-height: 320px; flex: auto; }
}
@media(max-width: 850px) { .node-history-grid { grid-template-columns: 1fr; } .history-node-list { max-height: 220px; border-right: 0; border-bottom: 1px solid var(--line); } .node-history .section-heading { flex-wrap: wrap; gap: 6px 12px; } }
@media(max-width: 600px) { .history-node-content .value-columns { grid-template-columns: 1fr; } }
</style>
