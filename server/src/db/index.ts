import sqlite3 from 'sqlite3'
import { readFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { AsyncLocalStorage } from 'node:async_hooks'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DB_PATH || join(__dirname, '../../../data/demo.db')

export interface WorkflowRow {
  id: number
  schema_version: number
  name: string
  description: string | null
  variables: string | null
  nodes: string
  edges: string
  publish_path: string | null
  is_published: number
  auth_type: string
  created_at: string
  updated_at: string
}

export type WorkflowListItem = Pick<
  WorkflowRow,
  'id' | 'name' | 'description' | 'is_published' | 'publish_path' | 'updated_at'
>

class WrappedStatement {
  constructor(private database: WrappedDatabase, private sql: string) {}

  run(params?: unknown): Promise<sqlite3.RunResult> {
    return this.database.run(this.sql, params)
  }

  get<T>(params?: unknown): Promise<T | undefined> {
    return this.database.get<T>(this.sql, params)
  }

  all<T>(params?: unknown): Promise<T[]> {
    return this.database.all<T>(this.sql, params)
  }
}

class WrappedDatabase {
  private queue: Promise<void> = Promise.resolve()
  private transactionContext = new AsyncLocalStorage<boolean>()

  constructor(private db: sqlite3.Database) {}

  private schedule<T>(action: () => Promise<T>): Promise<T> {
    if (this.transactionContext.getStore()) return action()
    const result = this.queue.then(action)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  exec(sql: string): Promise<void> {
    return this.schedule(() => new Promise<void>((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err)
        else resolve()
      })
    }))
  }

  prepare(sql: string): WrappedStatement {
    return new WrappedStatement(this, sql)
  }

  get<T>(sql: string, params?: unknown): Promise<T | undefined> {
    return this.schedule(() => new Promise<T | undefined>((resolve, reject) => {
      this.db.get<T>(sql, params ?? [], (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    }))
  }

  all<T>(sql: string, params?: unknown): Promise<T[]> {
    return this.schedule(() => new Promise<T[]>((resolve, reject) => {
      this.db.all<T>(sql, params ?? [], (err, rows) => {
        if (err) reject(err)
        else resolve(rows ?? [])
      })
    }))
  }

  run(sql: string, params?: unknown): Promise<sqlite3.RunResult> {
    return this.schedule(() => new Promise<sqlite3.RunResult>((resolve, reject) => {
      this.db.run(sql, params ?? [], function (err) {
        if (err) reject(err)
        else resolve(this)
      })
    }))
  }

  // 同一连接的异步事务串行执行；跨进程写锁交给 SQLite 的 busy_timeout。
  transaction<T>(action: () => Promise<T>, mode: 'read' | 'write' = 'write'): Promise<T> {
    if (this.transactionContext.getStore()) return action()
    return this.schedule(() => this.transactionContext.run(true, async () => {
      await this.exec(mode === 'read' ? 'BEGIN DEFERRED' : 'BEGIN IMMEDIATE')
      try {
        const value = await action()
        await this.exec('COMMIT')
        return value
      } catch (error) {
        await this.exec('ROLLBACK')
        throw error
      }
    }))
  }

  close(): Promise<void> {
    return this.schedule(() => new Promise<void>((resolve, reject) => {
      this.db.close(error => error ? reject(error) : resolve())
    }))
  }
}

function openDatabase(path: string): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path, (err) => {
      if (err) reject(err)
      else resolve(db)
    })
  })
}

export let db!: WrappedDatabase

export async function initializeDb(): Promise<WrappedDatabase> {
  mkdirSync(dirname(dbPath), { recursive: true })
  const rawDb = await openDatabase(dbPath)
  db = new WrappedDatabase(rawDb)
  await db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  await db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf-8'))
  await db.transaction(async () => {
    const workflowColumns = await db.all<{ name: string }>('PRAGMA table_info(workflows)')
    if (!workflowColumns.some(column => column.name === 'schema_version')) {
      await db.exec('ALTER TABLE workflows ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1')
    }
    const columns = await db.all<{ name: string }>('PRAGMA table_info(executions)')
    const existing = new Set(columns.map(column => column.name))
    const additions = {
      temporal_workflow_id: 'TEXT', engine_version: 'TEXT', start_state: "TEXT DEFAULT 'legacy'",
      request_key: 'TEXT', workflow_snapshot: 'TEXT', variables_snapshot: 'TEXT', limits_snapshot: 'TEXT',
      result_ref: 'TEXT', completion_status: 'TEXT', completion_error: 'TEXT'
    }
    for (const [column, definition] of Object.entries(additions)) {
      if (!existing.has(column)) await db.exec(`ALTER TABLE executions ADD COLUMN ${column} ${definition}`)
    }
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS executions_temporal_id ON executions(temporal_workflow_id); CREATE UNIQUE INDEX IF NOT EXISTS executions_request_key ON executions(request_key);')
  })
  return db
}

export async function getWorkflow(id: number): Promise<WorkflowRow | undefined> {
  return db.prepare('SELECT * FROM workflows WHERE id = ?').get<WorkflowRow>(id)
}

export async function listWorkflows(): Promise<WorkflowListItem[]> {
  return db
    .prepare('SELECT id, name, description, is_published, publish_path, updated_at FROM workflows')
    .all<WorkflowListItem>()
}
