import { afterAll, describe, expect, it } from 'vitest'
import sqlite3 from 'sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directory = await mkdtemp(join(tmpdir(), 'workflow-store-test-'))
process.env.DB_PATH = join(directory, 'legacy.db')
const database = await import('../src/db/index.js')
afterAll(async () => {
  await database.db.close()
  await rm(directory, { recursive: true, force: true })
})

describe('SQLite 增量迁移', () => {
  it('保留旧 execution，并开启跨进程 WAL 与等待锁配置', async () => {
    const legacy = new sqlite3.Database(process.env.DB_PATH)
    await new Promise<void>((resolve, reject) => legacy.exec(`CREATE TABLE executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workflow_id INTEGER, status TEXT, context TEXT, logs TEXT, result TEXT, started_at DATETIME, ended_at DATETIME);
      INSERT INTO executions(workflow_id,status,context,logs,result) VALUES(1,'success','{}','[]','false');
      CREATE TABLE workflows (id INTEGER PRIMARY KEY, name TEXT, description TEXT, variables TEXT, nodes TEXT, edges TEXT,
        publish_path TEXT, is_published BOOLEAN, auth_type TEXT, created_at DATETIME, updated_at DATETIME);
      INSERT INTO workflows(id,name,nodes,edges) VALUES(1,'旧定义','[]','[]');`, error => error ? reject(error) : resolve()))
    await new Promise<void>((resolve, reject) => legacy.close(error => error ? reject(error) : resolve()))
    const db = await database.initializeDb()
    expect(await db.get('SELECT id,status,result,start_state,temporal_workflow_id FROM executions WHERE id=1')).toEqual({ id: 1, status: 'success', result: 'false', start_state: 'legacy', temporal_workflow_id: null })
    expect(await db.get('PRAGMA journal_mode')).toEqual({ journal_mode: 'wal' })
    expect(await db.get('PRAGMA busy_timeout')).toEqual({ timeout: 5000 })
    const columns = await db.all<{ name: string }>('PRAGMA table_info(executions)')
    expect(columns.map(column => column.name)).toContain('workflow_snapshot')
    expect(await db.get('SELECT name,nodes,edges,schema_version FROM workflows WHERE id=1')).toEqual({ name: '旧定义', nodes: '[]', edges: '[]', schema_version: 1 })
  })
})
