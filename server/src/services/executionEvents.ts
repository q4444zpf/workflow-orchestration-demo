import type { Response } from 'express'
import { getExecutionRow, readExecutionEvents } from './executionStore.js'
import { synchronizeExecution } from './executionService.js'

export function registerExecutionConnection(executionId: number, res: Response, after = 0): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  res.write(`data: ${JSON.stringify({ type: 'connected', nodeId: '' })}\n\n`)
  let cursor = after
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let warned = false
  const heartbeat = setInterval(() => { if (!closed) res.write(':heartbeat\n\n') }, 15000)
  const close = () => { closed = true; clearInterval(heartbeat); clearTimeout(timer) }
  res.on('close', close)
  res.on('error', close)
  async function write(payload: string): Promise<void> {
    if (closed || res.writableEnded) return
    if (!res.write(payload)) {
      await new Promise<void>(resolve => {
        const done = () => { res.off('drain', done); res.off('close', done); resolve() }
        res.once('drain', done); res.once('close', done)
      })
    }
  }
  const pump = async () => {
    if (closed) return
    try {
      try { await synchronizeExecution(executionId); warned = false }
      catch {
        if (!warned) await write(`data: ${JSON.stringify({ type: 'syncWarning', nodeId: '', data: { message: 'Temporal 暂时不可用，正在等待恢复状态同步' } })}\n\n`)
        warned = true
      }
      const events = await readExecutionEvents(executionId, cursor)
      for (const event of events) {
        await write(`id: ${event.id}\ndata: ${JSON.stringify({ type: event.type, nodeId: event.nodeId, data: event.data })}\n\n`)
        cursor = event.id
        if (closed) return
      }
      const row = await getExecutionRow(executionId)
      if (events.length < 20 && row?.status !== 'running') { close(); res.end(); return }
      timer = setTimeout(() => { void pump() }, events.length === 20 ? 0 : 250)
    } catch {
      await write(`data: ${JSON.stringify({ type: 'streamError', nodeId: '', data: { message: '执行事件暂时不可读取，请重新连接' } })}\n\n`)
      close(); res.end()
    }
  }
  void pump()
}
