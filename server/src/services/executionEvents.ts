import type { Response } from 'express'

export interface ExecutionEvent {
  type: string
  nodeId: string
  data?: unknown
}

type Connection = {
  res: Response
  heartbeat: NodeJS.Timeout
}

const connections = new Map<number, Set<Connection>>()
const buffers = new Map<number, ExecutionEvent[]>()
const BUFFER_LIMIT = 1000

function flushBuffer(executionId: number, res: Response) {
  const buffer = buffers.get(executionId)
  if (!buffer) return
  for (const event of buffer) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
}

export function emitExecutionEvent(executionId: number, event: ExecutionEvent) {
  const buffer = buffers.get(executionId)
  if (buffer) {
    buffer.push(event)
    if (buffer.length > BUFFER_LIMIT) buffer.shift()
  } else {
    buffers.set(executionId, [event])
  }

  const connectionSet = connections.get(executionId)
  if (connectionSet) {
    for (const connection of connectionSet) {
      connection.res.write(`data: ${JSON.stringify(event)}\n\n`)
    }
  }
}

export function registerExecutionConnection(executionId: number, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  res.write('data: {"type":"connected"}\n\n')
  flushBuffer(executionId, res)

  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n')
  }, 15000)

  const connection: Connection = { res, heartbeat }
  const set = connections.get(executionId)
  if (set) {
    set.add(connection)
  } else {
    connections.set(executionId, new Set([connection]))
  }

  res.on('close', () => {
    clearInterval(heartbeat)
    const set = connections.get(executionId)
    if (set) {
      set.delete(connection)
      if (set.size === 0) {
        connections.delete(executionId)
      }
    }
  })
}

export function clearExecutionBuffer(executionId: number) {
  buffers.delete(executionId)
}
