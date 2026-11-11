import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const serverRoot = fileURLToPath(new URL('../../', import.meta.url))
export function releaseRoot() { return resolve(process.env.WORKFLOW_ENGINE_RELEASES_DIR || join(serverRoot, 'engine-releases')) }
export function validateVersion(version) {
  if (typeof version !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(version)) throw new Error('执行器版本只能包含1至64个字母、数字、下划线和连字符')
  return version
}
function inside(root, path) {
  const part = relative(resolve(root), resolve(path))
  if (!part || part.startsWith('..') || isAbsolute(part)) throw new Error(`路径不在目标目录内：${path}`)
  return resolve(path)
}
const sha256 = value => createHash('sha256').update(value).digest('hex')
export async function runNode(args, options = {}) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true, ...options })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolveRun() : reject(new Error(`子进程退出，状态 ${code}`)))
  })
}
export async function runNpm(args, cwd) {
  const npmPath = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  await runNode([npmPath, ...args], { cwd })
}

async function fileHashes(root) {
  const files = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const key = relative(root, path).split('\\').join('/')
      if (key === 'release.json') continue
      if (entry.isDirectory()) await walk(path)
      else files.push({ path, key, link: entry.isSymbolicLink() })
    }
  }
  await walk(root)
  const result = {}
  for (let offset = 0; offset < files.length; offset += 32) {
    await Promise.all(files.slice(offset, offset + 32).map(async ({ path, key, link }) => {
      if (link) {
        inside(root, await realpath(path))
        result[key] = `symlink:${sha256(await readlink(path))}`
      } else result[key] = sha256(await readFile(path))
    }))
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)))
}

/** 调用者先构建；每个版本独立安装锁定依赖，绝不引用工作区 node_modules。 */
export async function publishRelease({ serverRoot: sourceRoot, releasesRoot, version }) {
  validateVersion(version)
  const root = resolve(releasesRoot)
  const directory = inside(root, join(root, version))
  await mkdir(root, { recursive: true })
  try { await mkdir(directory) }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`执行器版本 ${version} 已存在，禁止覆盖；请使用新版本号`)
    throw error
  }
  try {
    for (const name of ['dist', 'Dockerfile.runner', 'src/runner', 'package.json', 'package-lock.json']) {
      await mkdir(dirname(join(directory, name)), { recursive: true })
      await cp(join(sourceRoot, name), join(directory, name), { recursive: true, dereference: true })
    }
    for (const name of ['dist/temporal/worker.js', 'dist/temporal/workflows.js', 'dist/temporal/activities.js', 'dist/db/schema.sql', 'src/runner/runner.py']) await lstat(join(directory, name))
    // npm新版默认拦截安装脚本；只允许本项目锁文件中的原生准备依赖。
    // strict检查也覆盖已省略的dev条目，故列出esbuild，但仍不安装dev依赖。
    await writeFile(join(directory, '.npmrc'), 'allow-scripts=sqlite3,@swc/core,protobufjs,esbuild\nstrict-allow-scripts=true\n')
    await runNpm(['ci', '--omit=dev', '--no-audit', '--no-fund', '--prefer-offline', '--ignore-scripts=false'], directory)
    // 保留独立依赖根，并逐项确认生产依赖解析在本发布件内。
    await mkdir(join(directory, 'node_modules'), { recursive: true })
    const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    const requireRelease = createRequire(join(directory, 'package.json'))
    for (const name of Object.keys(pkg.dependencies || {})) inside(join(directory, 'node_modules'), requireRelease.resolve(name))
    // 原生SQLite必须能够加载；用子进程避免Windows文件锁阻止发布失败后的安全清理。
    if (pkg.dependencies?.sqlite3) await runNode(['--input-type=module', '-e', `import { createRequire } from 'node:module'; const r = createRequire(process.argv[1]); r('sqlite3'); r('@temporalio/worker');`, join(directory, 'package.json')], { cwd: directory })
    const manifest = {
      formatVersion: 1, engineVersion: version, taskQueue: `workflow-orchestration-${version}`,
      createdAt: new Date().toISOString(), nodeMajor: Number(process.versions.node.split('.')[0]),
      platform: process.platform, arch: process.arch, files: await fileHashes(directory)
    }
    await writeFile(join(directory, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
    return { directory, manifest, digest: sha256(await readFile(join(directory, 'release.json'))) }
  } catch (error) {
    await rm(inside(root, directory), { recursive: true, force: true })
    throw error
  }
}

export async function verifyRelease(releasesRoot, version) {
  validateVersion(version)
  const directory = inside(releasesRoot, join(releasesRoot, version))
  let raw
  try { raw = await readFile(join(directory, 'release.json')) }
  catch (error) { throw new Error(`执行器 ${version} 发布件不存在或尚未发布完成；禁止回退当前源码`, { cause: error }) }
  const manifest = JSON.parse(raw.toString('utf8'))
  if (manifest.formatVersion !== 1 || manifest.engineVersion !== version || manifest.taskQueue !== `workflow-orchestration-${version}`) throw new Error('发布件版本不匹配')
  if (manifest.platform !== process.platform || manifest.arch !== process.arch || manifest.nodeMajor !== Number(process.versions.node.split('.')[0])) throw new Error('发布件运行平台、架构或Node主版本不匹配，必须使用原运行环境')
  const actual = await fileHashes(directory)
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error(`执行器 ${version} 发布件完整性校验失败，代码、依赖或Python资源发生变动`)
  return { directory, manifest, digest: sha256(raw) }
}

export function workerLaunch(release, env = process.env) {
  const version = release.manifest.engineVersion
  if (env.WORKFLOW_ENGINE_VERSION && env.WORKFLOW_ENGINE_VERSION !== version) throw new Error('环境变量与发布件执行器版本不匹配')
  if (!env.DB_PATH || (env.DB_PATH !== ':memory:' && !isAbsolute(env.DB_PATH))) throw new Error('启动版本Worker必须设置绝对路径 DB_PATH，与API及其他版本共享数据库')
  return { args: [join(release.directory, 'dist', 'temporal', 'worker.js')], cwd: release.directory, env: { ...env, WORKFLOW_ENGINE_VERSION: version } }
}

export function assertHistoryVersion(history, version) {
  validateVersion(version)
  const start = history?.events?.find(event => event.workflowExecutionStartedEventAttributes)?.workflowExecutionStartedEventAttributes
  if (!start) throw new Error('历史缺少Workflow开始事件，不能判断执行器版本')
  const payload = start.input?.payloads?.[0]
  let input
  try {
    const encoding = Buffer.from(payload.metadata.encoding, typeof payload.metadata.encoding === 'string' ? 'base64' : undefined).toString('utf8')
    if (encoding !== 'json/plain') throw new Error('不支持的输入编码')
    input = JSON.parse(Buffer.from(payload.data, typeof payload.data === 'string' ? 'base64' : undefined).toString('utf8'))
  } catch (error) { throw new Error('无法解码历史中的执行器版本', { cause: error }) }
  if (input.engineVersion !== version) throw new Error(`历史执行器版本不匹配：历史 ${input.engineVersion}，请求 ${version}`)
  if (start.taskQueue?.name !== `workflow-orchestration-${version}`) throw new Error('历史任务队列不匹配，禁止跨版本重放')
}

export async function readHistoryArchive(path, version) {
  const archive = JSON.parse(await readFile(path, 'utf8'))
  if (archive.formatVersion !== 1) throw new Error('不支持的历史归档格式；请使用 history:export 命令导出')
  if (archive.engineVersion !== version) throw new Error('历史归档执行器版本不匹配')
  assertHistoryVersion(archive.history, version)
  return archive
}

export async function exportHistory({ release, workflowId, runId, outputPath, address, namespace }) {
  const requireRelease = createRequire(join(release.directory, 'package.json'))
  const { Client, Connection } = requireRelease('@temporalio/client')
  const { historyToJSON } = requireRelease('@temporalio/common/lib/proto-utils')
  const connection = await Connection.connect({ address })
  try {
    const client = new Client({ connection, namespace })
    const history = JSON.parse(historyToJSON(await client.workflow.getHandle(workflowId, runId).fetchHistory()))
    assertHistoryVersion(history, release.manifest.engineVersion)
    const archive = { formatVersion: 1, engineVersion: release.manifest.engineVersion, releaseDigest: release.digest, workflowId, runId, history }
    await writeFile(outputPath, `${JSON.stringify(archive, null, 2)}\n`, { flag: 'wx' })
    return archive
  } finally { await connection.close() }
}

export async function replayHistory({ release, historyPath }) {
  const archive = await readHistoryArchive(historyPath, release.manifest.engineVersion)
  if (archive.releaseDigest !== release.digest) throw new Error('历史归档与发布件摘要不匹配，必须使用导出时的完整发布件')
  // 隔离原生SDK及其版本，子进程退出后Windows也能正常清理测试发布件。
  await runNode([fileURLToPath(new URL('../replay-worker.mjs', import.meta.url)), release.directory, resolve(historyPath), release.manifest.engineVersion])
}
