import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { publishRelease, verifyRelease, assertHistoryVersion, readHistoryArchive, workerLaunch } from '../scripts/lib/engine-releases.mjs'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'test-versions-unit-'))
  roots.push(root)
  const source = join(root, 'source')
  await mkdir(join(source, 'dist', 'temporal'), { recursive: true })
  await mkdir(join(source, 'dist', 'db'), { recursive: true })
  await mkdir(join(source, 'src', 'runner'), { recursive: true })
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'test-versions-fixture', version: '1.0.0', type: 'module' }))
  await writeFile(join(source, 'package-lock.json'), JSON.stringify({ name: 'test-versions-fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'test-versions-fixture', version: '1.0.0' } } }))
  await writeFile(join(source, 'dist', 'temporal', 'worker.js'), `import { value } from './activities.js'; console.log(value, process.env.WORKFLOW_ENGINE_VERSION)`)
  await writeFile(join(source, 'dist', 'temporal', 'activities.js'), `export const value = '版本A的Activity'`)
  await writeFile(join(source, 'dist', 'temporal', 'workflows.js'), `export async function graphWorkflow() { return 'A' }`)
  await writeFile(join(source, 'dist', 'db', 'schema.sql'), 'SELECT 1;')
  await writeFile(join(source, 'Dockerfile.runner'), 'FROM python:3.11-alpine')
  await writeFile(join(source, 'src', 'runner', 'runner.py'), "print('A')")
  return { source, releasesRoot: join(root, 'releases') }
}
function history(version: string) {
  return { events: [{ workflowExecutionStartedEventAttributes: { taskQueue: { name: `workflow-orchestration-${version}` }, input: { payloads: [{ metadata: { encoding: Buffer.from('json/plain').toString('base64') }, data: Buffer.from(JSON.stringify({ executionId: 11, engineVersion: version })).toString('base64') }] } } }] }
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const path = resolve(root)
    const within = relative(resolve(tmpdir()), path)
    if (!within || within.startsWith('..') || isAbsolute(within) || !path.includes('test-versions-unit-')) throw new Error('拒绝清理非测试目录')
    await rm(path, { recursive: true, force: true })
  }
})

describe('完整执行器发布件', () => {
  it('版本A独立保留Activity及Python资源，源码升级后启动A仍执行旧代码', async () => {
    const { source, releasesRoot } = await fixture()
    await publishRelease({ serverRoot: source, releasesRoot, version: 'test-versions-A' })
    await writeFile(join(source, 'dist', 'temporal', 'activities.js'), `export const value = '版本B的Activity'`)
    await writeFile(join(source, 'src', 'runner', 'runner.py'), "print('B')")
    await publishRelease({ serverRoot: source, releasesRoot, version: 'test-versions-B' })
    const release = await verifyRelease(releasesRoot, 'test-versions-A')
    const launch = workerLaunch(release, { DB_PATH: ':memory:' })
    expect(execFileSync(process.execPath, launch.args, { env: launch.env, cwd: launch.cwd, encoding: 'utf8' })).toBe('版本A的Activity test-versions-A\n')
    expect(await readFile(join(release.directory, 'src', 'runner', 'runner.py'), 'utf8')).toBe("print('A')")
    expect((await verifyRelease(releasesRoot, 'test-versions-B')).manifest.taskQueue).toBe('workflow-orchestration-test-versions-B')
    expect(release.manifest.taskQueue).toBe('workflow-orchestration-test-versions-A')
  }, 30000)
  it('同名版本不可覆盖且禁止非法路径、缺失发布件和被改动的资源', async () => {
    const { source, releasesRoot } = await fixture()
    await expect(publishRelease({ serverRoot: source, releasesRoot, version: '../escape' })).rejects.toThrow(/版本/)
    await publishRelease({ serverRoot: source, releasesRoot, version: 'test-versions-immutable' })
    await expect(publishRelease({ serverRoot: source, releasesRoot, version: 'test-versions-immutable' })).rejects.toThrow(/已存在/)
    await expect(verifyRelease(releasesRoot, 'test-versions-missing')).rejects.toThrow(/发布件不存在/)
    await writeFile(join(releasesRoot, 'test-versions-immutable', 'src', 'runner', 'runner.py'), 'changed')
    await expect(verifyRelease(releasesRoot, 'test-versions-immutable')).rejects.toThrow(/校验失败/)
  }, 30000)
  it('正式Worker必须显式使用共享数据库，拒绝环境版本串用', async () => {
    const { source, releasesRoot } = await fixture()
    await publishRelease({ serverRoot: source, releasesRoot, version: 'test-versions-db' })
    const release = await verifyRelease(releasesRoot, 'test-versions-db')
    expect(() => workerLaunch(release, {})).toThrow(/DB_PATH/)
    expect(() => workerLaunch(release, { DB_PATH: ':memory:', WORKFLOW_ENGINE_VERSION: 'wrong' })).toThrow(/版本不匹配/)
  }, 30000)
})

describe('历史与发布版本校验', () => {
  it('匹配输入与队列才允许重放，错误版本在创建Worker前明确失败', () => {
    expect(() => assertHistoryVersion(history('test-versions-A'), 'test-versions-A')).not.toThrow()
    expect(() => assertHistoryVersion(history('test-versions-A'), 'test-versions-B')).toThrow(/版本不匹配/)
    const bad = history('test-versions-A')
    bad.events[0].workflowExecutionStartedEventAttributes.taskQueue.name = 'workflow-orchestration-test-versions-B'
    expect(() => assertHistoryVersion(bad, 'test-versions-A')).toThrow(/任务队列不匹配/)
    expect(() => assertHistoryVersion({ events: [] }, 'test-versions-A')).toThrow(/开始事件/)
  })
  it('导出归档中的版本不匹配时不可冒充匹配版本', async () => {
    const { releasesRoot } = await fixture()
    const path = join(releasesRoot, '..', 'history.json')
    await writeFile(path, JSON.stringify({ formatVersion: 1, engineVersion: 'test-versions-B', history: history('test-versions-A') }))
    await expect(readHistoryArchive(path, 'test-versions-A')).rejects.toThrow(/版本不匹配/)
  })
})
