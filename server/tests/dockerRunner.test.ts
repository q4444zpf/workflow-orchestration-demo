import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, it, expect } from 'vitest'
import * as runner from '../src/services/dockerRunner.js'

const { runPythonCode } = runner
const docker = promisify(execFile)
const containerName = (key: string) => `workflow-python-${createHash('sha256').update(key).digest('hex').slice(0, 40)}`

async function expectRemoved(key: string) {
  const { stdout } = await docker('docker', ['ps', '-aq', '--filter', `name=^/${containerName(key)}$`])
  expect(stdout.trim()).toBe('')
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 80))
  }
  throw new Error('等待 Docker 状态超时')
}

async function sandboxImage() {
  const { stdout } = await docker('docker', ['images', 'workflow-python-sandbox', '--format', '{{.Repository}}:{{.Tag}}'])
  const image = stdout.trim().split(/\r?\n/)[0]
  if (!image) throw new Error('测试沙箱镜像尚未构建')
  return image
}

describe('dockerRunner', () => {
  // First run may need to build the Docker image, so allow extra time.
  const TEST_TIMEOUT_MS = 120000
  it('returns sum of input numbers', async () => {
    const result = await runPythonCode('OUTPUT = sum(INPUT)', { INPUT: [1, 2, 3] })
    expect(result.success).toBe(true)
    expect(result.output).toBe(6)
  }, TEST_TIMEOUT_MS)

  it('returns error for invalid code', async () => {
    const result = await runPythonCode('raise ValueError("bad")', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('bad')
  }, TEST_TIMEOUT_MS)

  it('超时会等待容器移除后返回明确失败', async () => {
    const invocationKey = randomUUID()
    const result = await runPythonCode('import time\ntime.sleep(3)\nOUTPUT = 7', {}, { timeoutMs: 400, invocationKey })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/timed out|超时/i)
    await expectRemoved(invocationKey)
  }, TEST_TIMEOUT_MS)

  it('取消会等待容器移除后抛出 AbortError', async () => {
    const invocationKey = randomUUID()
    const controller = new AbortController()
    const execution = runPythonCode('import time\ntime.sleep(3)\nOUTPUT = 7', {}, { signal: controller.signal, invocationKey })
    const settled = expect(execution).rejects.toMatchObject({ name: 'AbortError' })
    await waitUntil(async () => {
      const { stdout } = await docker('docker', ['ps', '-q', '--filter', `name=^/${containerName(invocationKey)}$`])
      return Boolean(stdout.trim())
    })
    controller.abort()
    await settled
    await expectRemoved(invocationKey)
  }, TEST_TIMEOUT_MS)

  it('按 UTF8 字节拒绝超限结果并清理容器', async () => {
    const invocationKey = randomUUID()
    const result = await runPythonCode('OUTPUT = "河" * 100', {}, { maxOutputBytes: 100, invocationKey })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/output.*limit|输出.*上限/i)
    expect(result.output).toBeUndefined()
    await expectRemoved(invocationKey)
  }, TEST_TIMEOUT_MS)

  it('UTF8 结果在字节上限以内时完整返回并保留 print 日志', async () => {
    const result = await runPythonCode('print("日志")\nOUTPUT = "河" * 32', {}, { maxOutputBytes: 100 })
    expect(result.success).toBe(true)
    expect(result.output).toBe('河'.repeat(32))
    expect(result.logs).toContain('日志')
  }, TEST_TIMEOUT_MS)

  it('持续向 stdout 写入时立即停止并报告输出超限', async () => {
    const invocationKey = randomUUID()
    const result = await runPythonCode('import os\nwhile True:\n    os.write(1, b"x" * 65536)', {}, { invocationKey, maxOutputBytes: 100, timeoutMs: 5000 })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/output.*limit|输出.*上限/i)
    await expectRemoved(invocationKey)
  }, TEST_TIMEOUT_MS)

  it('日志超限会停止执行而不继续积累输出', async () => {
    const invocationKey = randomUUID()
    const result = await runPythonCode('print("x" * 200000)\nOUTPUT = 7', {}, { invocationKey })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/limit|上限/i)
    expect(Buffer.byteLength(result.logs)).toBeLessThanOrEqual(65536)
    await expectRemoved(invocationKey)
  }, TEST_TIMEOUT_MS)

  it('无协议的多字节 stdout 也遵守日志字节上限', async () => {
    const result = await runPythonCode('import os\nos.write(1, ("河" * 30000).encode())\nos._exit(1)', {})
    expect(result.success).toBe(false)
    expect(Buffer.byteLength(result.logs)).toBeLessThanOrEqual(65536)
  }, TEST_TIMEOUT_MS)

  it('同一逻辑调用会清理自身遗留容器', async () => {
    const invocationKey = randomUUID()
    const invocation = createHash('sha256').update(invocationKey).digest('hex')
    const name = containerName(invocationKey)
    const image = await sandboxImage()
    await docker('docker', ['create', '--name', name, '--label', 'com.workflow-orchestration-demo.sandbox=true',
      '--label', `com.workflow-orchestration-demo.invocation=${invocation}`, '--entrypoint', 'sleep', image, '60'])
    try {
      const result = await runPythonCode('OUTPUT = 7', {}, { invocationKey })
      expect(result.success).toBe(true)
      expect(result.output).toBe(7)
      await expectRemoved(invocationKey)
    } finally {
      await docker('docker', ['rm', '-f', name]).catch(() => {})
    }
  }, TEST_TIMEOUT_MS)

  it('名称相同但不属于当前调用的容器不会被删除', async () => {
    const invocationKey = randomUUID()
    const name = containerName(invocationKey)
    const image = await sandboxImage()
    await docker('docker', ['create', '--name', name, '--entrypoint', 'sleep', image, '60'])
    try {
      await expect(runPythonCode('OUTPUT = 7', {}, { invocationKey })).rejects.toThrow(/not owned/i)
      const { stdout } = await docker('docker', ['ps', '-aq', '--filter', `name=^/${name}$`])
      expect(Boolean(stdout.trim())).toBe(true)
    } finally {
      await docker('docker', ['rm', '-f', name]).catch(() => {})
    }
  }, TEST_TIMEOUT_MS)

  it('过期清理只移除带项目标签且已过期的容器', async () => {
    const image = await sandboxImage()
    const names = ['expired', 'active', 'foreign', 'no-deadline'].map(kind => `wf-test-${kind}-${randomUUID()}`)
    const cases = [
      ['--label', 'com.workflow-orchestration-demo.sandbox=true', '--label', 'com.workflow-orchestration-demo.deadline=1'],
      ['--label', 'com.workflow-orchestration-demo.sandbox=true', '--label', `com.workflow-orchestration-demo.deadline=${Date.now() + 60000}`],
      ['--label', 'com.workflow-orchestration-demo.deadline=1'],
      ['--label', 'com.workflow-orchestration-demo.sandbox=true']
    ]
    try {
      for (let i = 0; i < names.length; i++) {
        await docker('docker', ['create', '--name', names[i], ...cases[i], '--entrypoint', 'sleep', image, '60'])
      }
      await runner.cleanupExpiredSandboxContainers()
      for (let i = 0; i < names.length; i++) {
        const { stdout } = await docker('docker', ['ps', '-aq', '--filter', `name=^/${names[i]}$`])
        expect(Boolean(stdout.trim())).toBe(i !== 0)
      }
    } finally {
      for (const name of names) await docker('docker', ['rm', '-f', name]).catch(() => {})
    }
  }, TEST_TIMEOUT_MS)

  it('Worker 被强杀后容器仍在自身时限内退出并自动移除', async () => {
    const invocationKey = randomUUID()
    const name = containerName(invocationKey)
    const moduleUrl = new URL('../src/services/dockerRunner.ts', import.meta.url).href
    const tsxLoader = new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href
    const source = `import { runPythonCode } from ${JSON.stringify(moduleUrl)}; await runPythonCode('import time\\ntime.sleep(60)', {}, { timeoutMs: 2000, invocationKey: ${JSON.stringify(invocationKey)} });`
    // 从仓库根目录启动，确保镜像资源路径不依赖 server 工作目录。
    const worker = spawn(process.execPath, ['--import', tsxLoader, '--input-type=module', '-e', source], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)), stdio: 'ignore', windowsHide: true
    })
    let taskDir: string | undefined
    try {
      await waitUntil(async () => {
        const { stdout } = await docker('docker', ['ps', '-q', '--filter', `name=^/${name}$`])
        return Boolean(stdout.trim())
      })
      const { stdout } = await docker('docker', ['inspect', '--format', '{{json .}}', name])
      const inspected: unknown = JSON.parse(stdout)
      if (inspected === null || typeof inspected !== 'object') throw new Error('Docker inspect 数据无效')
      const hostConfig: unknown = Reflect.get(inspected, 'HostConfig')
      expect(hostConfig).toMatchObject({ Init: true, AutoRemove: true, ReadonlyRootfs: true, NetworkMode: 'none', Memory: 134217728, NanoCpus: 500000000 })
      const mounts: unknown = Reflect.get(inspected, 'Mounts')
      if (Array.isArray(mounts)) {
        for (const mount of mounts) {
          if (mount !== null && typeof mount === 'object' && Reflect.get(mount, 'Destination') === '/tmp/task') {
            const source: unknown = Reflect.get(mount, 'Source')
            if (typeof source === 'string') taskDir = source
          }
        }
      }
      const exited = new Promise(resolve => worker.once('exit', resolve))
      expect(worker.kill('SIGKILL')).toBe(true)
      await exited
      await waitUntil(async () => {
        const { stdout } = await docker('docker', ['ps', '-aq', '--filter', `name=^/${name}$`])
        return !stdout.trim()
      }, 6000)
      await expectRemoved(invocationKey)
    } finally {
      worker.kill('SIGKILL')
      await docker('docker', ['rm', '-f', name]).catch(() => {})
      // Docker Desktop 的 Linux 挂载路径不可直接当作 Windows 目录删除。
      if (taskDir && /^[A-Za-z]:[\\/].*[\\/]wf-python-[^\\/]+$/.test(taskDir)) rmSync(taskDir, { recursive: true, force: true })
    }
  }, TEST_TIMEOUT_MS)
})
