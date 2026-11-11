import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, Connection } from '@temporalio/client'
import { publishRelease, verifyRelease, workerLaunch, exportHistory, replayHistory } from '../scripts/lib/engine-releases.mjs'

// 此集成验证会安装两份真实、独立的SDK依赖，显式开启以避免每轮单元测试重复安装。
describe.skipIf(process.env.RUN_ENGINE_RELEASE_INTEGRATION !== '1')('真实Temporal固定版本发布件', () => {
  it('新版先完成且旧版只由匹配Worker恢复，重放不导入Activity或产生外部副作用', async () => {
    const root = await mkdtemp(join(tmpdir(), 'test-versions-temporal-'))
    const source = join(root, 'source')
    const releasesRoot = join(root, 'releases')
    const server = fileURLToPath(new URL('../', import.meta.url))
    const versionA = `test-versions-A-${randomUUID()}`
    const versionB = `test-versions-B-${randomUUID()}`
    const marker = join(root, 'activity-side-effects.txt')
    const processes: ReturnType<typeof spawn>[] = []
    const handles: ReturnType<Client['workflow']['getHandle']>[] = []
    let connection: Connection | undefined
    let logs = ''
    try {
      await mkdir(source, { recursive: true })
      for (const name of ['package.json', 'package-lock.json', 'Dockerfile.runner', 'src/runner', 'dist']) {
        await mkdir(join(source, name, '..'), { recursive: true })
        await cp(join(server, name), join(source, name), { recursive: true })
      }
      // 使用真实图Workflow及发布/启动器；Activity替身仅写本测试拥有的文件。
      await writeFile(join(source, 'dist', 'temporal', 'worker.js'), `
import { Worker, NativeConnection } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import * as activities from './activities.js';
const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
try {
  const worker = await Worker.create({ connection, namespace: 'default', taskQueue: 'workflow-orchestration-' + process.env.WORKFLOW_ENGINE_VERSION, workflowsPath: fileURLToPath(new URL('./workflows.js', import.meta.url)), activities, shutdownGraceTime: '1 second' });
  await worker.run();
} finally { await connection.close(); }
`)
      async function activityCode(value: string) {
        await writeFile(join(source, 'dist', 'temporal', 'activities.js'), `
import { appendFileSync } from 'node:fs';
const marker = ${JSON.stringify(marker)};
appendFileSync(marker, 'import-${value}\\n');
export async function loadExecutionPlan(id, engineVersion) {
  if (engineVersion !== process.env.WORKFLOW_ENGINE_VERSION) throw new Error('版本不匹配');
  return { nodes: [{id:'s',type:'start',timeoutMs:30000,maximumAttempts:1}],edges:[],limits:{maxNodeCalls:1000,maxOutputBytes:1048576} };
}
export async function executeNodeActivity() { appendFileSync(marker,'Activity-${value}\\n'); return {outputRef:'${value}-result',contextRef:null}; }
export async function completeControlActivity() { throw new Error('不应执行控制汇总'); }
export async function finishExecution() {}
`)
      }
      await activityCode('A')
      await publishRelease({ serverRoot: source, releasesRoot, version: versionA })
      await activityCode('B')
      await publishRelease({ serverRoot: source, releasesRoot, version: versionB })
      const releaseA = await verifyRelease(releasesRoot, versionA)
      const releaseB = await verifyRelease(releasesRoot, versionB)
      const address = process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233'
      connection = await Connection.connect({ address })
      const client = new Client({ connection })
      const handleA = await client.workflow.start('graphWorkflow', { workflowId: `${versionA}-execution`, taskQueue: releaseA.manifest.taskQueue, args: [{ executionId: 11, engineVersion: versionA }], workflowExecutionTimeout: '2 minutes' })
      handles.push(handleA)
      async function start(release: typeof releaseA) {
        const { args, ...options } = workerLaunch(release, { ...process.env, DB_PATH: join(root, 'isolated.db'), TEMPORAL_ADDRESS: address, WORKFLOW_ENGINE_VERSION: release.manifest.engineVersion })
        const child = spawn(process.execPath, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        child.stdout?.on('data', chunk => { logs += chunk.toString() })
        child.stderr?.on('data', chunk => { logs += chunk.toString() })
        child.on('error', error => { logs += error.message })
        processes.push(child)
      }
      await start(releaseB)
      const handleB = await client.workflow.start('graphWorkflow', { workflowId: `${versionB}-execution`, taskQueue: releaseB.manifest.taskQueue, args: [{ executionId: 12, engineVersion: versionB }], workflowExecutionTimeout: '2 minutes' })
      handles.push(handleB)
      expect(await handleB.result()).toBe('B-result')
      expect((await handleA.describe()).status.name).toBe('RUNNING')
      expect(await readFile(marker, 'utf8')).toBe('import-B\nActivity-B\n')
      await start(releaseA)
      expect(await handleA.result()).toBe('A-result')
      const historyPath = join(root, 'matching-history.json')
      await exportHistory({ release: releaseA, workflowId: handleA.workflowId, outputPath: historyPath, address, namespace: 'default' })
      const before = await readFile(marker, 'utf8')
      await replayHistory({ release: releaseA, historyPath })
      expect(await readFile(marker, 'utf8')).toBe(before)
      await expect(replayHistory({ release: releaseB, historyPath })).rejects.toThrow(/版本不匹配/)
    } catch (error) {
      throw new Error(`固定版本集成失败。Worker输出：\n${logs}`, { cause: error })
    } finally {
      for (const handle of handles) {
        try { if ((await handle.describe()).status.name === 'RUNNING') await handle.terminate('test-versions测试清理') } catch { /* 只处理本测试创建的Workflow。 */ }
      }
      for (const child of processes) {
        if (child.exitCode !== null) continue
        const closed = new Promise<void>(resolveClose => child.once('close', () => resolveClose()))
        child.kill()
        await closed
      }
      await connection?.close()
      const path = resolve(root)
      const within = relative(resolve(tmpdir()), path)
      if (!within || within.startsWith('..') || isAbsolute(within) || !path.includes('test-versions-temporal-')) throw new Error('拒绝清理非测试目录')
      await rm(path, { recursive: true, force: true })
    }
  }, 240000)
})
