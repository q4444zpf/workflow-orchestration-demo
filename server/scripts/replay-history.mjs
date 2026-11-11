import { releaseRoot, replayHistory, verifyRelease } from './lib/engine-releases.mjs'
if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
  console.log('用法：npm run history:replay -- <版本> <历史归档文件>\n使用匹配发布件离线重放，不执行真实 Activity。')
  process.exit(0)
}
const [version, historyPath] = process.argv.slice(2)
if (!version || !historyPath || process.argv.length !== 4) throw new Error('用法：npm run history:replay -- <版本> <历史归档文件>')
const release = await verifyRelease(releaseRoot(), version)
await replayHistory({ release, historyPath })
console.log(`历史重放成功：${historyPath}，执行器版本 ${version}`)
