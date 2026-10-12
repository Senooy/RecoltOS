/**
 * Opening a library database: pragmas, migrations (`-pre-vN` snapshot),
 * prepared-statement cache with a slow-query log (> 16 ms, dev).
 * No `electron` import: the log is injected by the caller (`library/`).
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '../../shared/errors'
import { migrate, type MigrateOptions, type MigrateResult } from './migrate'

export const DB_FILE = 'recolt.db'
export const SLOW_QUERY_MS = 16
export const DEFAULT_BUSY_TIMEOUT_MS = 5000

export type SlowQueryLogger = (sql: string, ms: number) => void

export interface OpenOptions {
  readonly?: boolean
  /** `busy_timeout` in ms (default 5 000; lowered in tests). */
  busyTimeout?: number
  /** Slow-query log (dev); absent = no timing. */
  onSlowQuery?: SlowQueryLogger
  slowQueryMs?: number
}

/** Applies the pragmas (WAL, foreign keys, busy timeout) on an open connection. */
export function applyPragmas(db: Database.Database, busyTimeout = DEFAULT_BUSY_TIMEOUT_MS): void {
  if (!db.readonly) {
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
  }
  db.pragma('foreign_keys = ON')
  db.pragma(`busy_timeout = ${Math.max(0, Math.trunc(busyTimeout))}`)
  db.pragma('temp_store = MEMORY')
  db.pragma('cache_size = -32000')
  db.pragma('mmap_size = 268435456')
}

/**
 * Prepared statements are accessed ONCE per connection. In dev, `run/get/all`
 * are timed and any execution over the threshold is logged.
 */
export interface Prepared {
  (sql: string): Database.Statement
}

const caches = new WeakMap<Database.Database, Map<string, Database.Statement>>()
const slowLoggers = new WeakMap<Database.Database, { log: SlowQueryLogger; threshold: number }>()

function instrument(
  stmt: Database.Statement,
  sql: string,
  log: SlowQueryLogger,
  threshold: number,
): Database.Statement {
  for (const method of ['run', 'get', 'all'] as const) {
    const original: (...args: unknown[]) => unknown = Reflect.get(stmt, method)
    const timed = (...args: unknown[]): unknown => {
      const t0 = performance.now()
      try {
        return original.apply(stmt, args)
      } finally {
        const ms = performance.now() - t0
        if (ms > threshold) log(sql, ms)
      }
    }
    Object.defineProperty(stmt, method, { value: timed, configurable: true, writable: true })
  }
  return stmt
}

/** Prepared-statement cache attached to the connection (shared by all repos). */
export function preparedFor(db: Database.Database): Prepared {
  let cache = caches.get(db)
  if (!cache) {
    cache = new Map()
    caches.set(db, cache)
  }
  const map = cache
  return (sql: string) => {
    let stmt = map.get(sql)
    if (!stmt) {
      stmt = db.prepare(sql)
      const slow = slowLoggers.get(db)
      if (slow) stmt = instrument(stmt, sql, slow.log, slow.threshold)
      map.set(sql, stmt)
    }
    return stmt
  }
}

/** Opens (or creates) a SQLite database and applies the pragmas. */
export function openDatabase(file: string, opts: OpenOptions = {}): Database.Database {
  if (!opts.readonly) fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file, opts.readonly ? { readonly: true, fileMustExist: true } : {})
  try {
    applyPragmas(db, opts.busyTimeout)
  } catch (err) {
    db.close()
    throw err
  }
  if (opts.onSlowQuery) {
    slowLoggers.set(db, { log: opts.onSlowQuery, threshold: opts.slowQueryMs ?? SLOW_QUERY_MS })
  }
  return db
}

export interface OpenLibraryDbOptions extends OpenOptions, Omit<MigrateOptions, 'snapshotsDir'> {}

export interface OpenedLibraryDb {
  db: Database.Database
  file: string
  migration: MigrateResult
}

/**
 * Opens `<root>/recolt.db`, applies the migrations (snapshot in `<root>/snapshots/` if the database
 * is not empty) and checks that foreign keys are active.
 */
export function openLibraryDb(root: string, opts: OpenLibraryDbOptions = {}): OpenedLibraryDb {
  const file = path.join(root, DB_FILE)
  const db = openDatabase(file, opts)
  try {
    const migration = migrate(db, {
      snapshotsDir: path.join(root, 'snapshots'),
      ...(opts.migrations ? { migrations: opts.migrations } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    })
    if (db.pragma('foreign_keys', { simple: true }) !== 1) {
      throw new AppError('library_unavailable', 'Foreign keys are off on the connection.')
    }
    return { db, file, migration }
  } catch (err) {
    db.close()
    throw err
  }
}
