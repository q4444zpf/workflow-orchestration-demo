import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Worker, NativeConnection } from '@temporalio/worker'
import { initializeDb } from '../db/index.js'
import { cleanupExpiredSandboxContainers } from '../services/dockerRunner.js'
import * as activities from './activities.js'
import { getEngineVersion, taskQueueFor, temporalAddress, temporalNamespace } from './config.js'

const version = getEngineVersion()
await initializeDb()
async function cleanupSandbox() {
  try { await cleanupExpiredSandboxContainers() }
  catch (error) { console.warn('过期 Python 沙箱暂时无法清理', error instanceof Error ? error.message : String(error)) }
}
await cleanupSandbox()
const cleanupTimer = setInterval(() => { void cleanupSandbox() }, 30000)
cleanupTimer.unref()
const connection = await NativeConnection.connect({ address: temporalAddress() })
try {
  const javascript = fileURLToPath(new URL('./workflows.js', import.meta.url))
  const typescript = fileURLToPath(new URL('./workflows.ts', import.meta.url))
  const worker = await Worker.create({
    connection, namespace: temporalNamespace(), taskQueue: taskQueueFor(version),
    workflowsPath: existsSync(javascript) ? javascript : typescript,
    activities, maxConcurrentActivityTaskExecutions: 4,
    shutdownGraceTime: '10 seconds'
  })
  console.log(`Temporal Worker 已启动，执行器版本 ${version}，任务队列 ${taskQueueFor(version)}`)
  await worker.run()
} finally { clearInterval(cleanupTimer); await connection.close() }
