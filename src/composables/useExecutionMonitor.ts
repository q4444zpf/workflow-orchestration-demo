import { onBeforeUnmount, ref } from 'vue'
import { executionApi } from '../api'
import type { Execution, ExecutionLog, NodeExecutionState, NodeRun } from '../types'

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
function isState(value: unknown): value is NodeExecutionState {
  return isRecord(value) && ['pending', 'running', 'success', 'failed', 'stopped'].includes(String(value.status))
}
function isNodeRun(value: unknown): value is NodeRun {
  return isState(value) && isRecord(value) && typeof value.invocationId === 'string' && typeof value.nodeId === 'string'
    && typeof value.scopePath === 'string' && typeof value.attempt === 'number' && typeof value.startedAt === 'string' && value.status !== 'pending'
}
function isLog(value: unknown): value is ExecutionLog {
  return isRecord(value) && typeof value.time === 'string' && typeof value.nodeId === 'string'
    && ['info', 'error', 'debug'].includes(String(value.level)) && typeof value.message === 'string'
}

/** 持有一次执行的推送连接、事件游标和断线后的查询恢复。 */
export function useExecutionMonitor() {
  const execution = ref<Execution | null>(null)
  let stream: EventSource | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let lastEventId = ''
  const receivedIds = new Set<string>()

  function close() { clearTimeout(retry); stream?.close(); stream = null }
  function apply(event: unknown) {
    if (!execution.value || !isRecord(event)) return
    if (event.type === 'syncWarning' && isRecord(event.data) && typeof event.data.message === 'string') {
      execution.value.sync_warning = event.data.message || undefined
    } else if (event.type === 'nodeRun' && isNodeRun(event.data)) {
      const runs = execution.value.nodeRuns ||= []
      const data = event.data
      const index = runs.findIndex(run => run.invocationId === data.invocationId && run.attempt === data.attempt)
      if (index === -1) runs.push(data)
      else runs[index] = data
    } else if (event.type === 'state' && typeof event.nodeId === 'string' && isState(event.data)) {
      execution.value.context[event.nodeId] = { ...execution.value.context[event.nodeId], ...event.data }
    } else if (event.type === 'log' && isLog(event.data)) {
      execution.value.logs.push(event.data)
    }
  }

  function subscribe(id: number) {
    close()
    if (disposed || execution.value?.id !== id) return
    const source = executionApi.events(id, lastEventId || undefined)
    stream = source
    source.onmessage = message => {
      if (disposed || execution.value?.id !== id || stream !== source) return
      try {
        const event: unknown = JSON.parse(message.data)
        if (!isRecord(event)) return
        if (message.lastEventId) {
          if (receivedIds.has(message.lastEventId) || Number(message.lastEventId) <= Number(lastEventId)) return
          receivedIds.add(message.lastEventId)
          lastEventId = message.lastEventId
        }
        if (event.type === 'completed') { close(); void refresh(id); return }
        apply(event)
      } catch { /* 保留连接，后续事件或查询会恢复合法状态。 */ }
    }
    source.onerror = () => {
      if (disposed || stream !== source) return
      close()
      void refresh(id)
    }
  }

  async function refresh(id: number) {
    if (disposed || execution.value?.id !== id) return
    try {
      const latest: Execution = await executionApi.get(id)
      if (disposed || execution.value?.id !== id) return
      if (latest.last_event_id !== undefined && latest.last_event_id < Number(lastEventId || 0)) {
        // 旧查询可能晚于新推送到达；保留已应用的状态及游标。
        if (!stream) retry = setTimeout(() => subscribe(id), 1000)
        return
      }
      execution.value = latest
      if (latest.last_event_id !== undefined) lastEventId = String(Math.max(Number(lastEventId) || 0, latest.last_event_id))
      if (latest.status !== 'running') { close(); return }
      if (!stream) retry = setTimeout(() => subscribe(id), 1000)
    } catch {
      if (!disposed && execution.value?.id === id) retry = setTimeout(() => { void refresh(id) }, 1000)
    }
  }

  function monitorExecution(id: number, workflowId: number, warning?: string) {
    close()
    lastEventId = ''
    receivedIds.clear()
    execution.value = { id, workflow_id: workflowId, status: 'running', context: {}, nodeRuns: [], logs: [], result: null,
      started_at: new Date().toISOString(), sync_warning: warning }
    subscribe(id)
    if (warning) void refresh(id)
  }
  onBeforeUnmount(() => { disposed = true; close() })
  return { execution, monitorExecution }
}
