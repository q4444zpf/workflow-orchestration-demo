import { spawn } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
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

function dockerEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(process.env.HTTP_PROXY ? { HTTP_PROXY: process.env.HTTP_PROXY } : {}),
    ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {})
  }
}

async function stopAndRemoveContainer(cidFile: string) {
  if (!existsSync(cidFile)) return
  try {
    const cid = readFileSync(cidFile, 'utf-8').trim()
    if (!cid) return
    await new Promise<void>((resolve) => {
      const stop = spawn('docker', ['stop', '--time', '0', cid], { env: dockerEnv() })
      stop.on('close', () => {
        const rm = spawn('docker', ['rm', cid], { env: dockerEnv() })
        rm.on('close', () => resolve())
        rm.on('error', () => resolve())
      })
      stop.on('error', () => resolve())
    })
  } catch {
    // Best-effort cleanup; ignore failures.
  }
}

export async function runPythonCode(code: string, inputs: Record<string, any>): Promise<PythonResult> {
  await ensureImage()

  const taskDir = mkdtempSync(join(tmpdir(), 'wf-python-'))
  const cidFile = join(taskDir, 'container.cid')
  writeFileSync(join(taskDir, 'inputs.json'), JSON.stringify(inputs))
  writeFileSync(join(taskDir, 'code.py'), code)

  return new Promise((resolve, reject) => {
    const args = [
      'run',
      '--cidfile', cidFile,
      '--network', 'none',
      '--read-only',
      '--memory', '128m',
      '--cpus', '0.5',
      '-v', `${taskDir}:/tmp/task:ro`,
      IMAGE_NAME
    ]

    const proc = spawn('docker', args, { timeout: TIMEOUT_MS, env: dockerEnv() })
    let stdout = ''
    let stderr = ''
    let cleanedUp = false

    function cleanup() {
      if (cleanedUp) return
      cleanedUp = true
      try { rmSync(taskDir, { recursive: true, force: true }) } catch {}
    }

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('error', async (err) => {
      await stopAndRemoveContainer(cidFile)
      cleanup()
      reject(err)
    })

    proc.on('close', async (code) => {
      await stopAndRemoveContainer(cidFile)
      cleanup()

      const match = stdout.match(/__RESULT_START__\r?\n([\s\S]+?)\r?\n__RESULT_END__/)
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
    const check = spawn('docker', ['images', '-q', IMAGE_NAME], { env: dockerEnv() })
    let out = ''
    let checkErr = ''

    check.stdout.on('data', (d) => { out += d })
    check.stderr.on('data', (d) => { checkErr += d })

    check.on('error', (err) => {
      reject(err)
    })

    check.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Docker unavailable (exit code ${code})${checkErr ? ': ' + checkErr.trim() : ''}`))
        return
      }
      if (out.trim()) {
        resolve()
        return
      }

      const build = spawn('docker', [
        'build',
        '-t', IMAGE_NAME,
        '-f', 'Dockerfile.runner',
        'src/runner'
      ], { env: dockerEnv() })
      let buildErr = ''

      build.stderr.on('data', (d) => { buildErr += d })

      build.on('error', (err) => {
        reject(err)
      })

      build.on('close', (c) => {
        if (c === 0) {
          resolve()
        } else {
          reject(new Error(`Docker build failed${buildErr ? ': ' + buildErr.trim() : ''}`))
        }
      })
    })
  })
}
