import { it, expect, vi } from 'vitest'
import { executionApi } from '../src/api'

it('事件续传将最后事件编号写入服务端支持的after查询参数', () => {
  const EventSource = vi.fn()
  vi.stubGlobal('EventSource', EventSource)
  try {
    executionApi.events(7, '41')
    expect(EventSource).toHaveBeenCalledWith('/api/executions/7/events?after=41')
  } finally { vi.unstubAllGlobals() }
})
