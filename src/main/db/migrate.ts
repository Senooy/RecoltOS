/// <reference types="vite/client" />
/**
 * SQLite migrations. The `migrations/NNNN_nom.sql` files are embedded at build time by
 * `import.meta.glob(…, { query: '?raw' })` and applied in order. `PRAGMA user_version` = number of
 * the last applied migration (set here, never in the SQL file).
 *
 * Before any migration of a NON-empty database: `VACUUM INTO 'snapshots/recolt-<ts>-pre-v<N>.db'`
 * (outside any transaction). Each migration runs in its own transaction: a failure rolls back the
 * current migration and leaves `user_version` unchanged.
 * No `electron` import (testable under Node).
 */
import type Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '../../shared/errors'
import { mt } from '../i18n'

export interface Migration {
  version: number
  name: string
  sql: string
}

const FILE_RE = /^(\d{4})_([a-z0-9_-]+)\.sql$/

/** Parses `{ path: content }` files into sorted, contiguous migrations (1, 2, 3…). */
export function parseMigrations(files: Record<string, string>): Migration[] {
  const out: Migration[] = []
  for (const [file, sql] of Object.entries(files)) {
    const base = file.split('/').pop() ?? file
    const m = FILE_RE.exec(base)
    if (!m?.[1] || !m[2]) throw new Error(`invalid migration name: ${base}`)
    out.push({ version: Number(m[1]), name: m[2], sql })
  }
  out.sort((a, b) => a.version - b.version)
  out.forEach((mig, i) => {
    if (mig.version !== i + 1) {
      throw new Error(`non-contiguous migrations: expected ${i + 1}, found ${mig.version}`)
    }
  })
  return out
}

let bundled: Migration[] | null = null

/** Embedded migrations (`src/main/db/migrations/*.sql`). */
export function bundledMigrations(): Migration[] {
  bundled ??= parseMigrations(
    import.meta.glob<string>('./migrations/*.sql', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  )
  return bundled
}

/** `YYYYMMDD-HHmmss` in local time (snapshot names). */
export function snapshotStamp(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

/** Free path `snapshots/recolt-<stamp>-<reason>.db` (suffix `-2`, `-3`… on collision). */
export function snapshotPath(dir: string, reason: string, at: number): string {
  const base = `recolt-${snapshotStamp(at)}-${reason}`
  let candidate = path.join(dir, `${base}.db`)
  for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(dir, `${base}-${n}.db`)
  return candidate
}

/** Consistent copy of the database (`VACUUM INTO`, does not block WAL readers). */
export function vacuumInto(db: Database.Database, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  db.prepare('VACUUM INTO ?').run(target)
}

export interface MigrateOptions {
  /** Folder for the `-pre-vN` snapshots; without it, no copy is made. */
  snapshotsDir?: string
  migrations?: Migration[]
  now?: () => number
}

export interface MigrateResult {
  from: number
  to: number
  applied: number[]
  snapshot: string | null
}

function isEmptyDatabase(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT count(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
    .get() as { n: number }
  return row.n === 0
}

export function migrate(db: Database.Database, opts: MigrateOptions = {}): MigrateResult {
  const migrations = opts.migrations ?? bundledMigrations()
  const latest = migrations.length
  const from = db.pragma('user_version', { simple: true }) as number
  if (from > latest) {
    throw new AppError('library_unavailable', mt().errors.libraryTooNew(from))
  }
  const pending = migrations.filter((m) => m.version > from)
  if (pending.length === 0) return { from, to: from, applied: [], snapshot: null }

  let snapshot: string | null = null
  if (opts.snapshotsDir && !isEmptyDatabase(db)) {
    snapshot = snapshotPath(opts.snapshotsDir, `pre-v${latest}`, (opts.now ?? Date.now)())
    vacuumInto(db, snapshot)
  }

  const applied: number[] = []
  for (const mig of pending) {
    if (needsForeignKeysOff(mig.sql)) {
      applyWithForeignKeysOff(db, mig)
    } else {
      db.transaction(() => {
        db.exec(mig.sql)
        db.pragma(`user_version = ${mig.version}`)
      })()
    }
    applied.push(mig.version)
  }
  return { from, to: latest, applied, snapshot }
}

/**
 * Optional migration header: `-- recolt:foreign_keys=off` (on its own line). It allows the
 * procedure (create, copy, drop, rename) without cascading to child tables.
 */
const FK_OFF_HEADER = /^--\s*recolt:foreign_keys\s*=\s*off\s*$/im

export function needsForeignKeysOff(sql: string): boolean {
  return FK_OFF_HEADER.test(sql)
}

/**
 * `PRAGMA foreign_keys` has no effect inside a transaction: the migration is therefore applied
 * outside a transaction with keys disabled, then `foreign_key_check` validates everything in a
 * transaction (failure = rollback, `user_version` unchanged). Keys are restored in
 * all cases, to their original value.
 */
function applyWithForeignKeysOff(db: Database.Database, mig: Migration): void {
  const previous = db.pragma('foreign_keys', { simple: true }) as number
  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      db.exec(mig.sql)
      const broken = db.pragma('foreign_key_check') as unknown[]
      if (broken.length > 0) {
        throw new AppError(
          'library_unavailable',
          mt().errors.migrationAborted(mig.version, broken.length),
        )
      }
      db.pragma(`user_version = ${mig.version}`)
    })()
  } finally {
    db.pragma(`foreign_keys = ${previous ? 'ON' : 'OFF'}`)
  }
}
