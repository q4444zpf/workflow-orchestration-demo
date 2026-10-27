import { spawn } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export interface PythonResult {
  output: any
  logs: string
  success: boolean
  error?: string
}

const IMAGE_NAME = 'workflow-python-sandbox'
const TIMEOUT_MS = 30000
const DOCKER_ENV = {
  ...process.env,
  HTTP_PROXY: process.env.HTTP_PROXY || 'http://127.0.0.1:7897',
  HTTPS_PROXY: process.env.HTTPS_PROXY || 'http://127.0.0.1:7897'
}

export async function runPythonCode(code: string, inputs: Record<string, any>): Promise<PythonResult> {
  await ensureImage()

  const taskDir = mkdtempSync(join(tmpdir(), 'wf-python-'))
  writeFileSync(join(taskDir, 'inputs.json'), JSON.stringify(inputs))
  writeFileSync(join(taskDir, 'code.py'), code)

  return new Promise((resolve) => {
    const args = [
      'run', '--rm',
      '--network', 'none',
      '--read-only',
      '--memory', '128m',
      '--cpus', '0.5',
      '-v', `${taskDir}:/tmp/task:ro`,
      IMAGE_NAME
    ]

    const proc = spawn('docker', args, { timeout: TIMEOUT_MS, env: DOCKER_ENV })
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      try { rmSync(taskDir, { recursive: true, force: true }) } catch {}

      const match = stdout.match(/__RESULT_START__\n([\s\S]+?)\n__RESULT_END__/)
      if (match) {
        try {
          const result = JSON.parse(match[1])
          resolve({
            output: result.success ? result.output : undefined,
            logs: stderr || '',
            success: result.success,
            error: result.error
          })
          return
        } catch {}
      }

      resolve({
        output: undefined,
        logs: stderr || stdout,
        success: false,
        error: code === null ? 'Execution timed out' : `Process exited with code ${code}`
      })
    })
  })
}

async function ensureImage(): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = spawn('docker', ['images', '-q', IMAGE_NAME], { env: DOCKER_ENV })
    let out = ''
    check.stdout.on('data', (d) => { out += d })
    check.on('close', (code) => {
      if (code !== 0 || out.trim()) {
        resolve()
        return
      }
      const build = spawn('docker', [
        'build',
        '-t', IMAGE_NAME,
        '-f', 'Dockerfile.runner',
        'src/runner'
      ], { env: DOCKER_ENV })
      build.on('close', (c) => c === 0 ? resolve() : reject(new Error('Docker build failed')))
    })
  })
}
