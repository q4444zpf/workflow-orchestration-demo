import { spawn, execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

export interface PythonResult {
  output: unknown
  logs: string
  success: boolean
  error?: string
}

export interface PythonRunOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxOutputBytes?: number
  invocationKey?: string
}

const TIMEOUT_MS = 30000
const OUTPUT_BYTES = 1024 * 1024
const LOG_BYTES = 64 * 1024
const PROJECT_LABEL = 'com.workflow-orchestration-demo.sandbox'
const DEADLINE_LABEL = 'com.workflow-orchestration-demo.deadline'
const INVOCATION_LABEL = 'com.workflow-orchestration-demo.invocation'
// src/services 与 dist/services 相对 server 根目录的位置相同。
const SERVER_DIR = fileURLToPath(new URL('../../', import.meta.url))
const docker = promisify(execFile)
let imagePromise: Promise<string> | undefined

async function dockerCommand(args: string[]) {
  return docker('docker', args, { env: process.env, timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })
}

function abortError(cause: unknown): Error {
  const error = new Error('Python execution canceled', { cause })
  error.name = 'AbortError'
  return error
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason)
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`)
  return value
}

function property(value: unknown, name: string): unknown {
  return value !== null && typeof value === 'object' ? Reflect.get(value, name) : undefined
}

function isMissingContainer(error: unknown): boolean {
  const stderr = property(error, 'stderr')
  return typeof stderr === 'string' && /No such (?:container|object)/i.test(stderr)
}

async function removeContainer(id: string): Promise<void> {
  try {
    await dockerCommand(['rm', '--force', id])
  } catch (error) {
    if (!isMissingContainer(error)) throw new Error(`Failed to remove Python sandbox ${id}`, { cause: error })
  }
}

async function inspectContainer(id: string): Promise<unknown> {
  try {
    const { stdout } = await dockerCommand(['inspect', '--type', 'container', id])
    const parsed: unknown = JSON.parse(stdout)
    return Array.isArray(parsed) ? parsed[0] : undefined
  } catch (error) {
    if (isMissingContainer(error)) return undefined
    throw error
  }
}

function labels(container: unknown): unknown {
  return property(property(container, 'Config'), 'Labels')
}

async function removePreviousInvocation(name: string, invocation: string): Promise<void> {
  const previous = await inspectContainer(name)
  if (previous === undefined) return
  if (property(labels(previous), PROJECT_LABEL) !== 'true' || property(labels(previous), INVOCATION_LABEL) !== invocation) {
    throw new Error(`Refusing to remove a container not owned by this Python invocation: ${name}`)
  }
  const id = property(previous, 'Id')
  if (typeof id !== 'string') throw new Error('Docker returned an invalid sandbox container ID')
  await removeContainer(id)
}

/** 仅回收本项目带有效过期时间的容器，保留其他执行及用户容器。 */
export async function cleanupExpiredSandboxContainers(): Promise<void> {
  const { stdout } = await dockerCommand(['ps', '--all', '--quiet', '--filter', `label=${PROJECT_LABEL}=true`])
  for (const id of stdout.trim().split(/\s+/).filter(Boolean)) {
    const container = await inspectContainer(id)
    if (property(labels(container), PROJECT_LABEL) !== 'true') continue
    const deadline = property(labels(container), DEADLINE_LABEL)
    if (typeof deadline !== 'string' || !/^\d+$/.test(deadline)) continue
    const deadlineMs = Number(deadline)
    if (Number.isSafeInteger(deadlineMs) && deadlineMs <= Date.now()) await removeContainer(id)
  }
}

async function buildImage(): Promise<string> {
  const dockerfile = join(SERVER_DIR, 'Dockerfile.runner')
  const runnerDir = join(SERVER_DIR, 'src', 'runner')
  // runner 修改后使用新标签，避免机器上旧镜像绕过输出边界。
  const version = createHash('sha256').update(readFileSync(dockerfile)).update(readFileSync(join(runnerDir, 'runner.py'))).digest('hex').slice(0, 16)
  const image = `workflow-python-sandbox:${version}`
  const { stdout } = await dockerCommand(['images', '--quiet', image])
  if (!stdout.trim()) await dockerCommand(['build', '--tag', image, '--file', dockerfile, runnerDir])
  return image
}

async function ensureImage(): Promise<string> {
  imagePromise ??= buildImage().catch(error => {
    imagePromise = undefined
    throw error
  })
  return imagePromise
}

function failed(error: string, logs = ''): PythonResult {
  return { output: undefined, logs, success: false, error }
}

function boundedText(chunks: Buffer[], limit: number): string {
  let value = Buffer.concat(chunks).toString('utf8')
  // 最后一块可能落在 UTF8 多字节字符中间；不让替代字符超出日志预算。
  while (Buffer.byteLength(value) > limit) value = value.slice(0, -1)
  return value
}

export async function runPythonCode(code: string, inputs: Record<string, unknown>, options: PythonRunOptions = {}): Promise<PythonResult> {
  const timeoutMs = positiveInteger(options.timeoutMs ?? TIMEOUT_MS, 'timeoutMs')
  const maxOutputBytes = positiveInteger(options.maxOutputBytes ?? OUTPUT_BYTES, 'maxOutputBytes')
  checkAborted(options.signal)
  const image = await ensureImage()
  checkAborted(options.signal)
  const invocation = createHash('sha256').update(options.invocationKey ?? randomUUID()).digest('hex')
  const name = `workflow-python-${invocation.slice(0, 40)}`
  await removePreviousInvocation(name, invocation)
  checkAborted(options.signal)
  const taskDir = mkdtempSync(join(tmpdir(), 'wf-python-'))
  let containerId: string | undefined
  try {
    writeFileSync(join(taskDir, 'inputs.json'), JSON.stringify(inputs))
    writeFileSync(join(taskDir, 'code.py'), code)
    const { stdout } = await dockerCommand([
      // init 占用 PID 1，BusyBox timeout 的看门狗才能向 Python 发送 SIGKILL。
      'create', '--rm', '--init', '--name', name,
      '--label', `${PROJECT_LABEL}=true`,
      '--label', `${INVOCATION_LABEL}=${invocation}`,
      '--label', `${DEADLINE_LABEL}=${Date.now() + timeoutMs + 1000}`,
      '--network', 'none', '--read-only', '--memory', '128m', '--cpus', '0.5',
      '--mount', `type=bind,source=${taskDir},target=/tmp/task,readonly`,
      '--env', `WORKFLOW_MAX_OUTPUT_BYTES=${maxOutputBytes}`,
      '--entrypoint', 'timeout', image,
      '-s', 'KILL', String(Math.ceil(timeoutMs / 1000)), 'python', '-u', '/runner/runner.py'
    ])
    containerId = stdout.trim()
    if (!/^[0-9a-f]{64}$/.test(containerId)) throw new Error('Docker returned an invalid sandbox container ID')
    checkAborted(options.signal)
    return await executeContainer(containerId, options.signal, timeoutMs, maxOutputBytes)
  } finally {
    try {
      if (containerId) await removeContainer(containerId)
    } finally {
      if (dirname(resolve(taskDir)) !== resolve(tmpdir()) || !basename(taskDir).startsWith('wf-python-')) {
        throw new Error('拒绝清理不属于本次 Python 调用的临时目录')
      }
      rmSync(taskDir, { recursive: true, force: true })
    }
  }
}

async function executeContainer(id: string, signal: AbortSignal | undefined, timeoutMs: number, maxOutputBytes: number): Promise<PythonResult> {
  const proc = spawn('docker', ['start', '--attach', id], { env: process.env, windowsHide: true })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let failure: 'abort' | 'timeout' | 'output' | 'logs' | undefined
  let cleanup: Promise<void> | undefined
  let cleanupError: unknown

  function stop(reason: NonNullable<typeof failure>) {
    if (failure) return
    failure = reason
    cleanup = removeContainer(id).catch(error => { cleanupError = error }).finally(() => { proc.kill() })
  }
  const onAbort = () => stop('abort')
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => stop('timeout'), timeoutMs)
  if (signal?.aborted) onAbort()

  proc.stdout.on('data', (chunk: Buffer) => {
    const budget = maxOutputBytes + LOG_BYTES
    const remaining = budget - stdoutBytes
    if (remaining > 0) stdout.push(chunk.subarray(0, remaining))
    stdoutBytes += chunk.length
    if (stdoutBytes > budget) stop('output')
  })
  proc.stderr.on('data', (chunk: Buffer) => {
    const remaining = LOG_BYTES - stderrBytes
    if (remaining > 0) stderr.push(chunk.subarray(0, remaining))
    stderrBytes += chunk.length
    if (stderrBytes > LOG_BYTES) stop('logs')
  })
  let exitCode: number | null
  try {
    exitCode = await new Promise<number | null>((resolve, reject) => {
      proc.once('error', reject)
      proc.once('close', resolve)
    })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    await cleanup
  }
  if (cleanupError) throw cleanupError
  if (failure === 'abort') throw abortError(signal?.reason)
  const logs = boundedText(stderr, LOG_BYTES)
  if (failure === 'timeout') return failed('Python execution timed out', logs)
  if (failure === 'output') return failed(`Python output exceeds limit of ${maxOutputBytes} bytes`, logs)
  if (failure === 'logs') return failed(`Python logs exceed limit of ${LOG_BYTES} bytes`, logs)
  const text = boundedText(stdout, maxOutputBytes + LOG_BYTES)
  const match = text.match(/__RESULT_START__\r?\n([\s\S]+?)\r?\n__RESULT_END__\s*$/)
  if (match) {
    try {
      const result: unknown = JSON.parse(match[1])
      const output = property(result, 'output')
      const error = property(result, 'error')
      if (property(result, 'success') === true) {
        if (Buffer.byteLength(JSON.stringify(output) ?? 'null') > maxOutputBytes) {
          return failed(`Python output exceeds limit of ${maxOutputBytes} bytes`, logs)
        }
        return { output, logs, success: true }
      }
      if (typeof error === 'string') return failed(error, logs)
    } catch {
      return failed('Python returned an invalid result frame', logs)
    }
  }
  return failed(`Python process exited with code ${exitCode}`, logs || boundedText([Buffer.from(text).subarray(0, LOG_BYTES)], LOG_BYTES))
}
