import { publishRelease, releaseRoot, runNpm, serverRoot, validateVersion } from './lib/engine-releases.mjs'
if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
  console.log('用法：npm run engine:publish -- <版本>\n构建并创建不可覆盖的完整执行器发布件。')
  process.exit(0)
}
const version = validateVersion(process.argv[2])
if (process.argv.length !== 3) throw new Error('用法：npm run engine:publish -- <版本>')
await runNpm(['run', 'build'], serverRoot)
const release = await publishRelease({ serverRoot, releasesRoot: releaseRoot(), version })
console.log(`执行器 ${version} 已发布：${release.directory}，任务队列 ${release.manifest.taskQueue}`)
