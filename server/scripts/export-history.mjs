import { exportHistory, releaseRoot, verifyRelease } from './lib/engine-releases.mjs'
if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
  console.log('用法：npm run history:export -- <版本> <WorkflowId> <输出文件> [RunId]\n导出匹配版本的历史，输出文件必须尚不存在。')
  process.exit(0)
}
const [version, workflowId, outputPath, runId] = process.argv.slice(2)
if (!version || !workflowId || !outputPath || process.argv.length > 6) throw new Error('用法：npm run history:export -- <版本> <WorkflowId> <输出文件> [RunId]')
const release = await verifyRelease(releaseRoot(), version)
await exportHistory({ release, workflowId, runId, outputPath, address: process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233', namespace: process.env.TEMPORAL_NAMESPACE || 'default' })
console.log(`历史已导出：${outputPath}，执行器版本 ${version}`)
