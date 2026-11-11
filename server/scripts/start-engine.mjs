import { spawn } from 'node:child_process'
import { releaseRoot, verifyRelease, workerLaunch } from './lib/engine-releases.mjs'
if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
  console.log('用法：npm run engine:start -- <版本>\n校验并启动已发布版本；必须设置绝对路径 DB_PATH。')
  process.exit(0)
}
if (process.argv.length !== 3) throw new Error('用法：npm run engine:start -- <版本>')
const release = await verifyRelease(releaseRoot(), process.argv[2])
const { args, ...options } = workerLaunch(release)
console.log(`启动固定发布件 ${release.manifest.engineVersion}：${release.directory}`)
const child = spawn(process.execPath, args, { ...options, stdio: 'inherit', windowsHide: true })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.once('error', error => { console.error(error); process.exitCode = 1 })
child.once('close', code => { process.exitCode = code ?? 1 })
