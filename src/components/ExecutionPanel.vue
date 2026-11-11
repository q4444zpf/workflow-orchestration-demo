<template>
  <section class="execution-panel" aria-label="执行监控">
    <header class="monitor-header">
      <h2>执行监控</h2>
      <span v-if="execution" class="run-status" :class="execution.status"><component :is="execution.status === 'failed' ? CircleCloseFilled : execution.status === 'running' ? Loading : CircleCheckFilled" :class="{ spinning: execution.status === 'running' }" />{{ statusText }}</span>
      <span v-else class="summary">等待运行</span>
      <template v-if="execution"><span class="summary">{{ execution.nodeRuns?.length ? '调用数' : '节点数' }} <b>{{ executedCount }}</b></span><span v-if="attemptCount > executedCount" class="summary">尝试数 <b>{{ attemptCount }}</b></span><span class="summary">耗时 <b>{{ totalDuration }}</b></span></template>
      <span v-if="execution?.id" class="execution-id">执行 #{{ execution.id }}</span>
    </header>
    <p v-if="execution?.sync_warning" class="sync-warning" role="status">{{ execution.sync_warning }}</p>
    <div class="monitor-tabs" role="tablist" aria-label="监控内容">
      <button role="tab" :aria-selected="activeTab === 'data'" aria-controls="execution-data" @click="activeTab = 'data'">节点数据</button>
      <button role="tab" :aria-selected="activeTab === 'logs'" aria-controls="execution-logs" @click="activeTab = 'logs'">运行日志 <span v-if="execution?.logs.length">{{ execution.logs.length }}</span></button>
      <button role="tab" :aria-selected="activeTab === 'result'" aria-controls="execution-result" @click="activeTab = 'result'">最终结果</button>
    </div>
    <div v-if="!execution" class="monitor-empty"><VideoPlay /><strong>运行工作流，查看每个节点的数据</strong><span>执行状态、输入输出和日志会在这里实时更新</span></div>
    <div v-else-if="activeTab === 'data'" id="execution-data" role="tabpanel" class="monitor-data">
      <div class="node-list"><div class="list-header"><span>节点</span><span>执行时间</span></div>
        <button v-for="row in rows" :key="row.key" :data-node-id="row.nodeId" :data-invocation-id="row.run?.invocationId" :data-attempt="row.run?.attempt" :aria-pressed="currentRow?.key === row.key" class="node-row" :class="{ active: currentRow?.key === row.key }" :title="row.run?.invocationId" @click="selectRow(row)">
          <CircleCheckFilled v-if="row.state?.status === 'success'" class="success-icon" />
          <CircleCloseFilled v-else-if="row.state?.status === 'failed'" class="failed-icon" />
          <Loading v-else-if="row.state?.status === 'running'" class="spinning running-icon" />
          <Remove v-else class="pending-icon" />
          <span class="row-name">{{ row.name }}<small v-if="row.run" class="run-scope">{{ row.run.scopePath }} · 第 {{ row.run.attempt }} 次尝试</small></span><span class="row-time">{{ nodeTime(row.state) }}</span>
        </button>
      </div>
      <div class="data-box"><div class="data-heading"><h3>输入</h3><button aria-label="复制输入" @click="copyValue(currentState?.input, 'input')"><CopyDocument />{{ copied === 'input' ? '已复制' : '复制' }}</button></div><pre data-testid="node-input">{{ formatValue(currentState?.input) }}</pre></div>
      <div class="data-box"><div class="data-heading"><h3>输出</h3><button aria-label="复制输出" @click="copyValue(currentState?.output, 'output')"><CopyDocument />{{ copied === 'output' ? '已复制' : '复制' }}</button></div><pre data-testid="node-output">{{ currentState?.error || formatValue(currentState?.output) }}</pre></div>
    </div>
    <div v-else-if="activeTab === 'logs'" id="execution-logs" role="tabpanel" class="log-list">
      <div v-for="(log, index) in execution.logs" :key="index" class="log-row" :class="log.level"><time>{{ new Date(log.time).toLocaleTimeString('zh-CN', { hour12: false }) }}</time><strong>{{ names[log.nodeId] || log.nodeId || '系统' }}</strong><span>{{ log.message }}</span></div><p v-if="!execution.logs.length">暂无日志</p>
    </div>
    <div v-else id="execution-result" role="tabpanel" class="result-view"><div class="data-heading"><h3>最终结果</h3><button aria-label="复制最终结果" @click="copyValue(execution.result, 'result')"><CopyDocument />{{ copied === 'result' ? '已复制' : '复制' }}</button></div><pre>{{ execution.status === 'running' ? '执行中，结果将在完成后显示' : formatValue(execution.result) }}</pre></div>
    <p v-if="copyError" class="copy-error" role="alert">复制失败，请手动选择文本复制</p>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, shallowRef, watch, onBeforeUnmount } from 'vue'
import { CircleCheckFilled, CircleCloseFilled, Loading, Remove, CopyDocument, VideoPlay } from '@element-plus/icons-vue'
import { nodeName } from './nodePresentation'
import type { Execution, FlowNode, NodeExecutionState, NodeRun } from '../types'
const props = defineProps<{ execution: Execution | null; selectedNodeId: string | null; nodes: FlowNode[] }>()
const emit = defineEmits<{ 'select-node': [id: string] }>()
const activeTab = ref('data')
const copied = ref('')
const copyError = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
const names = computed(() => Object.fromEntries(props.nodes.map(n => [n.id, nodeName(n)])))
interface MonitorRow { key: string; nodeId: string; name: string; state?: NodeExecutionState; run?: NodeRun }
const selectedRunKey = shallowRef<string | null>(null)
const rows = computed<MonitorRow[]>(() => props.execution?.nodeRuns?.length
  ? props.execution.nodeRuns.map(run => ({ key: JSON.stringify([run.invocationId, run.attempt]), nodeId: run.nodeId, name: names.value[run.nodeId] || run.nodeId, state: run, run }))
  : props.nodes.map(node => ({ key: node.id, nodeId: node.id, name: nodeName(node), state: props.execution?.context[node.id] })))
const currentRow = computed(() => {
  const selected = rows.value.find(row => row.key === selectedRunKey.value)
  if (selected && (!props.selectedNodeId || selected.nodeId === props.selectedNodeId)) return selected
  const matching = props.selectedNodeId ? rows.value.filter(row => row.nodeId === props.selectedNodeId) : rows.value.filter(row => row.state)
  return matching[matching.length - 1]
})
const currentState = computed(() => currentRow.value?.state)
const executedCount = computed(() => props.execution?.nodeRuns?.length ? new Set(props.execution.nodeRuns.map(run => run.invocationId)).size : Object.keys(props.execution?.context || {}).length)
const attemptCount = computed(() => props.execution?.nodeRuns?.length || 0)
watch(() => props.execution?.id, () => { selectedRunKey.value = null })
function selectRow(row: MonitorRow) { selectedRunKey.value = row.key; emit('select-node', row.nodeId) }
const statusText = computed(() => ({ running: '正在执行', success: '执行成功', failed: '执行失败', stopped: '已停止' })[props.execution?.status || 'running'])
function duration(start?: string, end?: string) {
  if (!start || !end) return '—'
  return Math.max(0, (Date.parse(end) - Date.parse(start)) / 1000).toFixed(2) + 's'
}
const totalDuration = computed(() => props.execution?.status === 'running' ? '执行中' : duration(props.execution?.started_at, props.execution?.ended_at))
function nodeTime(state?: NodeExecutionState) {
  if (!state) return '未执行'
  if (state.status === 'running') return '执行中'
  if (state.status === 'failed') return '失败'
  if (state.status === 'stopped') return '已停止'
  return duration(state.startedAt, state.endedAt)
}
function formatValue(value: unknown) { return value === undefined ? '暂无数据' : JSON.stringify(value, null, 2) }
async function copyValue(value: unknown, target: string) {
  try { await navigator.clipboard.writeText(formatValue(value)); copied.value = target; copyError.value = false; clearTimeout(copiedTimer); copiedTimer = setTimeout(() => { copied.value = '' }, 2000) }
  catch { copyError.value = true }
}
onBeforeUnmount(() => clearTimeout(copiedTimer))
</script>
<style scoped>
.execution-panel { min-height: 0; background: #fff; display: flex; flex-direction: column; padding: 18px 24px 22px; overflow: hidden; }
.sync-warning { margin: 8px 0 0; padding: 6px 10px; border-radius: 4px; background: #fff8e7; color: #8b6519; font-size: 12px; }
.run-scope { display: block; margin-top: 4px; font-size: 10px; color: #748095; font-weight: 400; overflow: hidden; text-overflow: ellipsis; }
.monitor-header { display: flex; align-items: center; gap: 24px; flex-shrink: 0; min-height: 30px; } h2 { font-size: 20px; margin: 0; letter-spacing: -.5px; } .run-status { display: inline-flex; gap: 8px; align-items: center; font-weight: 600; font-size: 14px; } .run-status svg { width: 20px; height: 20px; } .success, .success-icon { color: #32a332; } .failed, .failed-icon { color: #d84848; } .running, .running-icon { color: #1677ff; } .pending-icon { color: #a0a8b5; } .summary { color: #748095; font-size: 14px; } .summary b { color: #26344c; margin-left: 8px; font-weight: 500; } .execution-id { margin-left: auto; color: #7c889b; font-size: 12px; }
.monitor-tabs { display: flex; gap: 28px; border-bottom: 1px solid var(--line); margin-top: 12px; flex-shrink: 0; } .monitor-tabs button { background: none; border: 0; border-bottom: 2px solid transparent; padding: 12px 0; color: #58667c; font-size: 14px; } .monitor-tabs button[aria-selected="true"] { color: #1677ff; border-color: #1677ff; font-weight: 600; } .monitor-tabs button span { margin-left: 5px; color: #8693a7; font-size: 11px; }
.monitor-data { min-height: 0; display: grid; grid-template-columns: 320px minmax(0, 1fr) minmax(0, 1fr); gap: 20px; padding-top: 18px; flex: 1; }
.node-list { min-height: 0; overflow: auto; border: 1px solid var(--line); border-radius: 6px; align-self: stretch; } .list-header { position: sticky; top: 0; display: flex; justify-content: space-between; padding: 11px 14px; color: #758199; background: #f7f9fd; font-size: 12px; z-index: 1; } .node-row { width: 100%; display: flex; align-items: center; gap: 9px; padding: 11px 14px; background: white; border: 0; border-top: 1px solid #f0f2f7; color: #27354b; text-align: left; border-left: 3px solid transparent; font-size: 14px; } .node-row svg { width: 17px; height: 17px; flex-shrink: 0; } .node-row:hover { background: #f4f8ff; } .node-row.active { background: #eaf2ff; border-left-color: #1677ff; font-weight: 600; } .row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .row-time { margin-left: auto; color: #7b8799; font-size: 12px; white-space: nowrap; }
.data-box { min-width: 0; min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 6px; background: #fbfcff; overflow: hidden; } .data-heading { display: flex; align-items: center; justify-content: space-between; min-height: 40px; padding: 0 14px; border-bottom: 1px solid var(--line); flex-shrink: 0; } h3 { font-size: 14px; margin: 0; font-weight: 600; } .data-heading button { display: flex; align-items: center; gap: 6px; border: 0; background: none; color: #738199; font-size: 12px; } .data-heading button svg { width: 15px; height: 15px; } pre { margin: 0; padding: 16px; font: 13px/1.8 'Cascadia Code', Consolas, monospace; color: #23314b; overflow: auto; tab-size: 2; }
.log-list, .result-view { overflow: auto; min-height: 0; flex: 1; margin-top: 16px; } .log-row { display: flex; gap: 24px; padding: 9px 4px; border-bottom: 1px solid #f0f2f7; font: 12px/1.6 Consolas, monospace; } .log-row time { color: #8490a3; } .log-row strong { min-width: 100px; font-weight: 500; } .log-row.error { color: #d84848; } .monitor-empty { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 10px; color: #8a96a9; font-size: 13px; } .monitor-empty svg { width: 24px; height: 24px; color: #99b4da; } .monitor-empty strong { color: #5a6b83; font-weight: 500; } .copy-error { color: #d84848; font-size: 12px; margin: 4px 0; }
@media (max-width: 1150px) { .monitor-data { grid-template-columns: 200px minmax(0, 1fr) minmax(0, 1fr); gap: 12px; } .execution-panel { padding: 14px 16px 18px; } .monitor-header { gap: 16px; } }
</style>
