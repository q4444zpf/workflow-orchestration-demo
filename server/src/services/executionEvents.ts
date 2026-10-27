import type { Response } from 'express'

export interface ExecutionEvent {
  type: string
  nodeId: string
  data?: any
}

type Connection = {
  res: Response
  heartbeat: NodeJS.Timeout
}

const connections = new Map<number, Connection>()
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

  const connection = connections.get(executionId)
  if (connection) {
    connection.res.write(`data: ${JSON.stringify(event)}\n\n`)
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

  connections.set(executionId, { res, heartbeat })

  res.on('close', () => {
    clearInterval(heartbeat)
    connections.delete(executionId)
  })
}

export function clearExecutionBuffer(executionId: number) {
  buffers.delete(executionId)
}
