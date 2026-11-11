import { onBeforeUnmount, ref, watch } from 'vue'
import { executionApi } from '../api'
import type { Execution } from '../types'

/** 历史详情独立读取；路由切换、刷新和轮询共用同一请求世代。 */
export function useExecutionRecord(id: () => string) {
  const execution = ref<Execution | null>(null)
  const loading = ref(false)
  const error = ref('')
  let generation = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  async function load(reset = true) {
    const current = ++generation
    clearTimeout(timer)
    const number = Number(id())
    if (reset) execution.value = null
    error.value = ''
    if (!Number.isSafeInteger(number) || number <= 0) { error.value = '无效的执行编号'; loading.value = false; return }
    loading.value = reset
    try {
      const result = await executionApi.get(number)
      if (disposed || current !== generation) return
      execution.value = result
      if (result.status === 'running') timer = setTimeout(() => { void load(false) }, 3000)
    } catch {
      if (disposed || current !== generation) return
      error.value = '加载执行详情失败，请重试'
      if (execution.value?.status === 'running') timer = setTimeout(() => { void load(false) }, 3000)
    } finally {
      if (!disposed && current === generation) loading.value = false
    }
  }
  watch(id, () => { void load() }, { immediate: true })
  onBeforeUnmount(() => { disposed = true; generation++; clearTimeout(timer) })
  return { execution, loading, error, reload: () => load() }
}
