import { fileURLToPath } from 'node:url'
import { NativeConnection, Worker } from '@temporalio/worker'
import { initializeDb } from '../../src/db/index.js'
import * as activities from '../../src/temporal/activities.js'
import { getEngineVersion, taskQueueFor, temporalAddress, temporalNamespace } from '../../src/temporal/config.js'
import type { NodeCall } from '../../src/temporal/contracts.js'

// 测试专用包装：Activity 已持久化成功结果之后、SDK 回复 Temporal 之前强杀自身。
// 生产 Activities、Worker 和数据库不增加故障注入开关。
if (!process.env.DB_PATH || process.env.DB_PATH === ':memory:') throw new Error('恢复测试必须显式指定临时文件数据库')
await initializeDb()
const connection = await NativeConnection.connect({ address: temporalAddress() })
const worker = await Worker.create({
  connection, namespace: temporalNamespace(), taskQueue: taskQueueFor(getEngineVersion()),
  workflowsPath: fileURLToPath(new URL('../../src/temporal/workflows.ts', import.meta.url)),
  activities: {
    ...activities,
    executeNodeActivity: async (call: NodeCall) => {
      const result = await activities.executeNodeActivity(call)
      if (call.nodeId === 'http') process.kill(process.pid, 'SIGKILL')
      return result
    }
  }
})
try { await worker.run() } finally { await connection.close() }
