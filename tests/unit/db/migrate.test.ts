import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bundledMigrations,
  migrate,
  needsForeignKeysOff,
  parseMigrations,
  snapshotPath,
  snapshotStamp,
  type Migration,
} from '../../../src/main/db/migrate'
import { applyPragmas, openDatabase, openLibraryDb, preparedFor } from '../../../src/main/db/open'
import { tmpDir } from './helpers'

const dirs: string[] = []
const dbs: Database.Database[] = []
function dir(): string {
  const d = tmpDir()
  dirs.push(d)
  return d
}
function track(db: Database.Database): Database.Database {
  dbs.push(db)
  return db
}
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.open) db.close()
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const extra = (sql: string, version = 2, name = 'extra'): Migration => ({ version, name, sql })

describe('bundled migrations', () => {
  it('loaded by import.meta.glob, sorted and contiguous (0001 = init)', () => {
    const migs = bundledMigrations()
    expect(migs.length).toBeGreaterThanOrEqual(1)
    expect(migs[0]).toMatchObject({ version: 1, name: 'init' })
    expect(migs[0]!.sql).toContain('CREATE TABLE items')
    expect(bundledMigrations()).toBe(migs)
  })

  it('new database: latest user_version, pragmas, integrity, FTS5, JSON', () => {
    const root = dir()
    const { db, migration } = openLibraryDb(root)
    track(db)
    const latest = bundledMigrations().length
    expect(migration).toEqual({
      from: 0,
      to: latest,
      applied: Array.from({ length: latest }, (_, i) => i + 1),
      snapshot: null,
    })
    expect(db.pragma('user_version', { simple: true })).toBe(latest)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('synchronous', { simple: true })).toBe(1)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    expect(db.pragma('temp_store', { simple: true })).toBe(2)
    expect(db.pragma('cache_size', { simple: true })).toBe(-32000)
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(db.pragma('foreign_key_check')).toEqual([])
    const opts = (db.pragma('compile_options') as { compile_options: string }[]).map(
      (r) => r.compile_options,
    )
    expect(opts).toContain('ENABLE_FTS5')
    expect(db.prepare(`SELECT json_extract('{"a":2}', '$.a') AS v`).get()).toEqual({ v: 2 })
    // No snapshot for an empty database.
    expect(fs.existsSync(path.join(root, 'snapshots'))).toBe(false)
  })

  it('idempotent: a second open applies nothing', () => {
    const root = dir()
    track(openLibraryDb(root).db).close()
    const again = openLibraryDb(root)
    track(again.db)
    expect(again.migration.applied).toEqual([])
    expect(again.migration.snapshot).toBeNull()
  })
})

describe('migrate()', () => {
  it('VACUUM INTO -pre-vN snapshot before migrating a non-empty database', () => {
    const root = dir()
    const db = track(openDatabase(path.join(root, 'recolt.db')))
    const base = bundledMigrations().slice(0, 1)
    migrate(db, { migrations: base })
    db.prepare(
      "INSERT INTO items (uuid, kind, created_at, updated_at) VALUES ('u1', 'image', 1, 1)",
    ).run()
    const res = migrate(db, {
      migrations: [...base, extra('CREATE TABLE t2 (id INTEGER PRIMARY KEY);')],
      snapshotsDir: path.join(root, 'snapshots'),
      now: () => new Date(2026, 9, 11, 8, 5, 3).getTime(),
    })
    expect(res.applied).toEqual([2])
    expect(res.snapshot).toBe(path.join(root, 'snapshots', 'recolt-20261011-080503-pre-v2.db'))
    const snap = track(new Database(res.snapshot!, { readonly: true }))
    expect(snap.pragma('user_version', { simple: true })).toBe(1)
    expect(snap.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: 1 })
    expect(db.pragma('user_version', { simple: true })).toBe(2)
  })

  it('failure during migration: rollback, version unchanged', () => {
    const root = dir()
    const db = track(openDatabase(path.join(root, 'recolt.db')))
    const base = bundledMigrations().slice(0, 1)
    migrate(db, { migrations: base })
    const broken = extra('CREATE TABLE t2 (id INTEGER PRIMARY KEY); INSERT INTO nope VALUES (1);')
    expect(() => migrate(db, { migrations: [...base, broken] })).toThrow(/nope/)
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 't2'").get()).toBeUndefined()
  })

  it('database newer than the app: library_unavailable', () => {
    const db = track(openDatabase(path.join(dir(), 'recolt.db')))
    db.pragma('user_version = 99')
    expect(() => migrate(db)).toThrow(expect.objectContaining({ code: 'library_unavailable' }))
  })

  it('parseMigrations: invalid names and gaps refused', () => {
    expect(() => parseMigrations({ './migrations/init.sql': '' })).toThrow(/invalide/)
    expect(() =>
      parseMigrations({ './migrations/0001_a.sql': '', './migrations/0003_c.sql': '' }),
    ).toThrow(/contiguës/)
    expect(
      parseMigrations({ 'x/0002_b.sql': 'B', 'x/0001_a.sql': 'A' }).map((m) => m.name),
    ).toEqual(['a', 'b'])
  })

  it('snapshotPath: suffix on collision', () => {
    const d = dir()
    const at = new Date(2026, 0, 2, 3, 4, 5).getTime()
    expect(snapshotStamp(at)).toBe('20260102-030405')
    const first = snapshotPath(d, 'daily', at)
    fs.writeFileSync(first, '')
    expect(snapshotPath(d, 'daily', at)).toBe(path.join(d, 'recolt-20260102-030405-daily-2.db'))
  })
})

describe('openDatabase / prepared statements', () => {
  it('read-only: no forced WAL, non-existent database refused', () => {
    const root = dir()
    track(openLibraryDb(root).db).close()
    const ro = track(openDatabase(path.join(root, 'recolt.db'), { readonly: true }))
    expect(ro.readonly).toBe(true)
    expect(ro.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(() => openDatabase(path.join(root, 'absent.db'), { readonly: true })).toThrow()
  })

  it('cache: a prepared query prepared only once per connection', () => {
    const db = track(openDatabase(path.join(dir(), 'a.db')))
    const q = preparedFor(db)
    expect(q('SELECT 1 AS one')).toBe(q('SELECT 1 AS one'))
    expect(preparedFor(db)('SELECT 1 AS one')).toBe(q('SELECT 1 AS one'))
  })

  it('slow query log (dev) above the threshold', () => {
    const onSlowQuery = vi.fn()
    const db = track(openDatabase(path.join(dir(), 'a.db'), { onSlowQuery, slowQueryMs: -1 }))
    const q = preparedFor(db)
    q('CREATE TABLE t (x)').run()
    q('INSERT INTO t VALUES (?)').run(1)
    expect(q('SELECT x FROM t').get()).toEqual({ x: 1 })
    expect(q('SELECT x FROM t').all()).toEqual([{ x: 1 }])
    expect(onSlowQuery).toHaveBeenCalledTimes(4)
    expect(onSlowQuery).toHaveBeenCalledWith('SELECT x FROM t', expect.any(Number))
  })

  it('without log: no timing, default threshold 16 ms', () => {
    const onSlowQuery = vi.fn()
    const db = track(openDatabase(path.join(dir(), 'b.db'), { onSlowQuery }))
    preparedFor(db)('SELECT 1').get()
    expect(onSlowQuery).not.toHaveBeenCalled()
  })

  it('applyPragmas on an existing connection', () => {
    const db = track(new Database(path.join(dir(), 'c.db')))
    applyPragmas(db, 123)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(123)
  })

  it('openLibraryDb closes the database if the migration fails', () => {
    const root = dir()
    expect(() => openLibraryDb(root, { migrations: [extra('SYNTAX ERROR;', 1, 'bad')] })).toThrow()
    // The file is no longer locked: we can reopen and write it.
    const db = track(openDatabase(path.join(root, 'recolt.db')))
    expect(db.pragma('user_version', { simple: true })).toBe(0)
  })
})

describe('header -- recolt:foreign_keys=off', () => {
  const base: Migration[] = [
    {
      version: 1,
      name: 'init',
      sql: [
        'CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
        'CREATE TABLE child (id INTEGER PRIMARY KEY,',
        '  parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE);',
        "INSERT INTO parent (id, name) VALUES (1, 'a');",
        'INSERT INTO child (id, parent_id) VALUES (1, 1);',
      ].join('\n'),
    },
  ]
  const childCount = (db: Database.Database) =>
    (db.prepare('SELECT count(*) AS n FROM child').get() as { n: number }).n

  it('header detection (own line only)', () => {
    expect(needsForeignKeysOff('-- recolt:foreign_keys=off\nSELECT 1;')).toBe(true)
    expect(needsForeignKeysOff('--   recolt:foreign_keys = off  \nSELECT 1;')).toBe(true)
    expect(needsForeignKeysOff('SELECT 1; -- recolt:foreign_keys=off')).toBe(false)
    expect(needsForeignKeysOff('SELECT 1;')).toBe(false)
  })

  it('migration procedure (create, copy, drop, rename): child tables survive', () => {
    const db = track(openDatabase(path.join(dir(), 'recolt.db')))
    migrate(db, { migrations: base })
    const rebuild: Migration = {
      version: 2,
      name: 'rebuild',
      sql: [
        '-- recolt:foreign_keys=off',
        'CREATE TABLE parent_new (id INTEGER PRIMARY KEY, name TEXT NOT NULL, extra TEXT);',
        'INSERT INTO parent_new (id, name) SELECT id, name FROM parent;',
        'DROP TABLE parent;',
        'ALTER TABLE parent_new RENAME TO parent;',
      ].join('\n'),
    }
    const res = migrate(db, { migrations: [...base, rebuild] })
    expect(res.applied).toEqual([2])
    expect(db.pragma('user_version', { simple: true })).toBe(2)
    expect(childCount(db)).toBe(1)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('final check: a migration that orphans rows is cancelled, keys restored', () => {
    const db = track(openDatabase(path.join(dir(), 'recolt.db')))
    migrate(db, { migrations: base })
    const orphan: Migration = {
      version: 2,
      name: 'orphan',
      sql: '-- recolt:foreign_keys=off\nDELETE FROM parent;',
    }
    expect(() => migrate(db, { migrations: [...base, orphan] })).toThrow(/clé étrangère invalide/)
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(childCount(db)).toBe(1)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('without header, a PRAGMA foreign_keys=OFF in the SQL has no effect (cascade)', () => {
    const db = track(openDatabase(path.join(dir(), 'recolt.db')))
    migrate(db, { migrations: base })
    const naive: Migration = {
      version: 2,
      name: 'naive',
      sql: 'PRAGMA foreign_keys=OFF; DELETE FROM parent;',
    }
    migrate(db, { migrations: [...base, naive] })
    expect(childCount(db)).toBe(0)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})
