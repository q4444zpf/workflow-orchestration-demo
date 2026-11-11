import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(serverRoot, 'dist')
if (dirname(dist) !== serverRoot) throw new Error('构建输出目录超出 server')
await rm(dist, { recursive: true, force: true })
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc'], { cwd: serverRoot, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status || 1)
await mkdir(resolve(dist, 'db'), { recursive: true })
await copyFile(resolve(serverRoot, 'src/db/schema.sql'), resolve(dist, 'db/schema.sql'))
