import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('执行器运维命令帮助', () => {
  it.each(['engine:publish', 'engine:start', 'history:export', 'history:replay'])('%s 的帮助成功退出且不创建发布目录', script => {
    const temporary = mkdtempSync(join(tmpdir(), 'test-versions-help-'))
    const releasesRoot = join(temporary, 'releases')
    try {
      const npmPath = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
      const result = spawnSync(process.execPath, [npmPath, 'run', script, '--', '--help'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: { ...process.env, WORKFLOW_ENGINE_RELEASES_DIR: releasesRoot }, encoding: 'utf8', windowsHide: true
      })
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain(`用法：npm run ${script}`)
      expect(existsSync(releasesRoot)).toBe(false)
    } finally {
      const within = relative(resolve(tmpdir()), resolve(temporary))
      if (!within || within.startsWith('..') || isAbsolute(within) || !temporary.includes('test-versions-help-')) throw new Error('拒绝清理非测试目录')
      rmSync(temporary, { recursive: true, force: true })
    }
  })
})
