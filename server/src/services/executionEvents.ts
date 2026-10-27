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

function writeEvent(res: Response, event: ExecutionEvent | string): boolean {
  try {
    const payload = typeof event === 'string' ? `${event}\n\n` : `data: ${JSON.stringify(event)}\n\n`
    return res.write(payload)
  } catch {
    return false
  }
}

function removeConnection(executionId: number, connection: Connection) {
  clearInterval(connection.heartbeat)
  const set = connections.get(executionId)
  if (set) {
    set.delete(connection)
    if (set.size === 0) {
      connections.delete(executionId)
    }
  }
}

function flushBuffer(executionId: number, res: Response) {
  const buffer = buffers.get(executionId)
  if (!buffer) return
  for (const event of buffer) {
    writeEvent(res, event)
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
      writeEvent(connection.res, event)
    }
  }
}

export function registerExecutionConnection(executionId: number, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  writeEvent(res, { type: 'connected', nodeId: '' })
  flushBuffer(executionId, res)

  const heartbeat = setInterval(() => {
    writeEvent(res, ':heartbeat')
  }, 15000)

  const connection: Connection = { res, heartbeat }
  const set = connections.get(executionId)
  if (set) {
    set.add(connection)
  } else {
    connections.set(executionId, new Set([connection]))
  }

  res.on('error', () => {
    removeConnection(executionId, connection)
  })

  res.on('close', () => {
    removeConnection(executionId, connection)
  })
}

export function clearExecutionBuffer(executionId: number) {
  buffers.delete(executionId)
}
