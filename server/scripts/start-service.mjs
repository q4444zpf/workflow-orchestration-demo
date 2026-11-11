import { fork } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { releaseRoot, serverRoot, verifyRelease, workerLaunch } from './lib/engine-releases.mjs'

const version = process.env.WORKFLOW_ENGINE_VERSION || 'v4'
const dbPath = process.env.DB_PATH || join(serverRoot, '../data/demo.db')
if (!isAbsolute(dbPath)) throw new Error('DB_PATH 必须是 API 与 Worker 共用的绝对 SQLite 文件路径')

const env = { ...process.env, WORKFLOW_ENGINE_VERSION: version, DB_PATH: dbPath }
const release = await verifyRelease(releaseRoot(), version)
const worker = workerLaunch(release, env)
const development = process.argv.includes('--dev')
const shutdownHook = new URL('./lib/shutdown-with-parent.mjs', import.meta.url).href
const children = new Set()
let stopping = false

function stop(exitCode) {
  if (stopping) return
  stopping = true
  process.exitCode = exitCode
  for (const child of children) {
    if (child.connected) child.disconnect()
  }
  // 等待 Worker 的优雅退出；仍未退出时仅终止本次启动的进程。
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL')
  }, 16000).unref()
}

function launch(name, entry, cwd, env, imports = []) {
  const child = fork(entry, [], {
    cwd, env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    execArgv: ['--import', shutdownHook, ...imports]
  })
  children.add(child)
  child.once('close', (code, signal) => {
    children.delete(child)
    if (stopping) return
    console.error(`${name} 意外退出（${signal || code}），正在关闭本次启动的服务。`)
    stop(1)
  })
  child.on('error', error => {
    if (stopping) return
    console.error(`${name} 进程出错：${error.message}`)
    stop(1)
  })
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
console.log(`启动 API 和固定发布件 Worker ${version}，任务队列 ${release.manifest.taskQueue}`)
launch(`Worker ${version}`, worker.args[0], worker.cwd, worker.env)
launch('API', join(serverRoot, development ? 'src/index.ts' : 'dist/index.js'), serverRoot, env, development ? ['--import', 'tsx'] : [])
