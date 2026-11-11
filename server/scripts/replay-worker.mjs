import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readHistoryArchive, verifyRelease } from './lib/engine-releases.mjs'
const [directory, historyPath, version] = process.argv.slice(2)
const release = await verifyRelease(dirname(directory), version)
const archive = await readHistoryArchive(historyPath, version)
if (archive.releaseDigest !== release.digest) throw new Error('历史归档与发布件摘要不匹配')
const requireRelease = createRequire(join(release.directory, 'package.json'))
const { Worker } = requireRelease('@temporalio/worker')
const { historyFromJSON } = requireRelease('@temporalio/common/lib/proto-utils')
// 只读取Workflow及历史，绝不注册或导入Activities、HTTP、SQLite或Python执行器。
await Worker.runReplayHistory({ workflowsPath: join(release.directory, 'dist', 'temporal', 'workflows.js') }, historyFromJSON(archive.history), archive.workflowId)
