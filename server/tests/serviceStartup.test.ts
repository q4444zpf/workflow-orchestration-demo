import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const serverRoot = fileURLToPath(new URL('../', import.meta.url))

async function waitFor(condition: () => boolean, failure: () => string) {
  const deadline = Date.now() + 8000
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(failure())
    await delay(50)
  }
}

it('一条命令启动 API 和已发布 Worker，Worker 异常退出时关闭 API 并报错', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-service-test-'))
  const version = `test-service-${randomUUID()}`
  const directory = join(root, version)
  const dbPath = join(root, 'shared.sqlite')
  const workerPath = 'dist/temporal/worker.js'
  const worker = `
    console.log('测试 Worker', process.env.WORKFLOW_ENGINE_VERSION, process.env.DB_PATH);
    import('node:fs').then(({ existsSync }) => {
      setInterval(() => { if (existsSync('../stop-worker')) process.exit(7); }, 50);
    });
  `
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const address = probe.address()
  if (!address || typeof address === 'string') throw new Error('无法取得测试端口')
  const { port } = address
  await new Promise<void>((done, reject) => probe.close(error => error ? reject(error) : done()))
  await mkdir(join(directory, 'dist', 'temporal'), { recursive: true })
  await writeFile(join(directory, workerPath), worker)
  await writeFile(join(directory, 'release.json'), JSON.stringify({
    formatVersion: 1, engineVersion: version, taskQueue: `workflow-orchestration-${version}`,
    platform: process.platform, arch: process.arch, nodeMajor: Number(process.versions.node.split('.')[0]),
    files: { [workerPath]: createHash('sha256').update(worker).digest('hex') }
  }))

  const service = spawn(process.execPath, ['scripts/start-service.mjs', '--dev'], {
    cwd: serverRoot, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, WORKFLOW_ENGINE_VERSION: version, WORKFLOW_ENGINE_RELEASES_DIR: root }
  })
  let output = ''
  service.stdout.setEncoding('utf8').on('data', data => { output += data })
  service.stderr.setEncoding('utf8').on('data', data => { output += data })
  const closed = once(service, 'close')
  const url = `http://127.0.0.1:${port}/api/workflows`

  try {
    await waitFor(() => output.includes('Server running') || service.exitCode !== null, () => output)
    expect(output).toContain('Server running')
    await waitFor(() => output.includes(`测试 Worker ${version} ${dbPath}`), () => output)
    expect((await fetch(url)).ok).toBe(true)
    await writeFile(join(root, 'stop-worker'), '')
    await waitFor(() => service.exitCode !== null, () => output)
    expect(service.exitCode).toBe(1)
    expect(output).toMatch(/Worker.*退出.*7/)
    await expect(fetch(url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
  } finally {
    if (service.exitCode === null && service.signalCode === null) service.kill()
    await closed
    const within = relative(resolve(tmpdir()), resolve(root))
    if (!within.startsWith('workflow-service-test-') || isAbsolute(within)) throw new Error('拒绝清理非测试目录')
    await rm(root, { recursive: true, force: true })
  }
}, 25000)
