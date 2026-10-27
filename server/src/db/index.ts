import sqlite3 from 'sqlite3'
import { readFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DB_PATH || join(__dirname, '../../../data/demo.db')

export interface WorkflowRow {
  id: number
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
  constructor(private stmt: sqlite3.Statement) {}

  run(params?: any): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      this.stmt.run(params ?? [], function (err) {
        if (err) reject(err)
        else resolve(this)
      })
    })
  }

  get<T>(params?: any): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.stmt.get<T>(params ?? [], (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })
  }

  all<T>(params?: any): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.stmt.all<T>(params ?? [], (err, rows) => {
        if (err) reject(err)
        else resolve(rows ?? [])
      })
    })
  }
}

class WrappedDatabase {
  constructor(private db: sqlite3.Database) {}

  exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  prepare(sql: string): WrappedStatement {
    return new WrappedStatement(this.db.prepare(sql))
  }

  get<T>(sql: string, params?: any): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get<T>(sql, params ?? [], (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })
  }

  all<T>(sql: string, params?: any): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all<T>(sql, params ?? [], (err, rows) => {
        if (err) reject(err)
        else resolve(rows ?? [])
      })
    })
  }

  run(sql: string, params?: any): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params ?? [], function (err) {
        if (err) reject(err)
        else resolve(this)
      })
    })
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

let db!: WrappedDatabase

export async function init(): Promise<WrappedDatabase> {
  mkdirSync(dirname(dbPath), { recursive: true })
  const rawDb = await openDatabase(dbPath)
  db = new WrappedDatabase(rawDb)
  await db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf-8'))
  return db
}

export const ready: Promise<WrappedDatabase> = init()

export async function getWorkflow(id: number): Promise<WorkflowRow | undefined> {
  return db.prepare('SELECT * FROM workflows WHERE id = ?').get<WorkflowRow>(id)
}

export async function listWorkflows(): Promise<WorkflowListItem[]> {
  return db
    .prepare('SELECT id, name, description, is_published, publish_path, updated_at FROM workflows')
    .all<WorkflowListItem>()
}
