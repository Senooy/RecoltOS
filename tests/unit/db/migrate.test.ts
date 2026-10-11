import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bundledMigrations,
  migrate,
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

describe('migrations embarquées', () => {
  it('chargées par import.meta.glob, triées et contiguës (0001 = init)', () => {
    const migs = bundledMigrations()
    expect(migs.length).toBeGreaterThanOrEqual(1)
    expect(migs[0]).toMatchObject({ version: 1, name: 'init' })
    expect(migs[0]!.sql).toContain('CREATE TABLE items')
    expect(bundledMigrations()).toBe(migs)
  })

  it('base neuve : dernière user_version, pragmas, intégrité, FTS5, JSON', () => {
    const root = dir()
    const { db, migration } = openLibraryDb(root)
    track(db)
    const latest = bundledMigrations().length
    expect(migration).toEqual({ from: 0, to: latest, applied: [1], snapshot: null })
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
    // Aucun snapshot pour une base vide.
    expect(fs.existsSync(path.join(root, 'snapshots'))).toBe(false)
  })

  it('idempotent : une seconde ouverture n’applique rien', () => {
    const root = dir()
    track(openLibraryDb(root).db).close()
    const again = openLibraryDb(root)
    track(again.db)
    expect(again.migration.applied).toEqual([])
    expect(again.migration.snapshot).toBeNull()
  })
})

describe('migrate()', () => {
  it('snapshot VACUUM INTO -pre-vN avant de migrer une base non vide', () => {
    const root = dir()
    const db = track(openDatabase(path.join(root, 'recolt.db')))
    const base = bundledMigrations()
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

  it('échec en cours de migration : rollback, version inchangée', () => {
    const root = dir()
    const db = track(openDatabase(path.join(root, 'recolt.db')))
    const base = bundledMigrations()
    migrate(db, { migrations: base })
    const broken = extra('CREATE TABLE t2 (id INTEGER PRIMARY KEY); INSERT INTO nope VALUES (1);')
    expect(() => migrate(db, { migrations: [...base, broken] })).toThrow(/nope/)
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 't2'").get()).toBeUndefined()
  })

  it('base plus récente que l’app : library_unavailable', () => {
    const db = track(openDatabase(path.join(dir(), 'recolt.db')))
    db.pragma('user_version = 99')
    expect(() => migrate(db)).toThrow(expect.objectContaining({ code: 'library_unavailable' }))
  })

  it('parseMigrations : noms invalides et trous refusés', () => {
    expect(() => parseMigrations({ './migrations/init.sql': '' })).toThrow(/invalide/)
    expect(() =>
      parseMigrations({ './migrations/0001_a.sql': '', './migrations/0003_c.sql': '' }),
    ).toThrow(/contiguës/)
    expect(
      parseMigrations({ 'x/0002_b.sql': 'B', 'x/0001_a.sql': 'A' }).map((m) => m.name),
    ).toEqual(['a', 'b'])
  })

  it('snapshotPath : suffixe en cas de collision', () => {
    const d = dir()
    const at = new Date(2026, 0, 2, 3, 4, 5).getTime()
    expect(snapshotStamp(at)).toBe('20260102-030405')
    const first = snapshotPath(d, 'daily', at)
    fs.writeFileSync(first, '')
    expect(snapshotPath(d, 'daily', at)).toBe(path.join(d, 'recolt-20260102-030405-daily-2.db'))
  })
})

describe('openDatabase / préparées', () => {
  it('lecture seule : pas de WAL forcé, base inexistante refusée', () => {
    const root = dir()
    track(openLibraryDb(root).db).close()
    const ro = track(openDatabase(path.join(root, 'recolt.db'), { readonly: true }))
    expect(ro.readonly).toBe(true)
    expect(ro.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(() => openDatabase(path.join(root, 'absent.db'), { readonly: true })).toThrow()
  })

  it('cache : une requête préparée une seule fois par connexion', () => {
    const db = track(openDatabase(path.join(dir(), 'a.db')))
    const q = preparedFor(db)
    expect(q('SELECT 1 AS one')).toBe(q('SELECT 1 AS one'))
    expect(preparedFor(db)('SELECT 1 AS one')).toBe(q('SELECT 1 AS one'))
  })

  it('journal des requêtes lentes (dev) au-delà du seuil', () => {
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

  it('sans journal : aucun chronométrage, seuil par défaut 16 ms', () => {
    const onSlowQuery = vi.fn()
    const db = track(openDatabase(path.join(dir(), 'b.db'), { onSlowQuery }))
    preparedFor(db)('SELECT 1').get()
    expect(onSlowQuery).not.toHaveBeenCalled()
  })

  it('applyPragmas sur une connexion existante', () => {
    const db = track(new Database(path.join(dir(), 'c.db')))
    applyPragmas(db, 123)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(123)
  })

  it('openLibraryDb ferme la base si la migration échoue', () => {
    const root = dir()
    expect(() => openLibraryDb(root, { migrations: [extra('SYNTAX ERROR;', 1, 'bad')] })).toThrow()
    // Le fichier n'est plus verrouillé : on peut le rouvrir et l'écrire.
    const db = track(openDatabase(path.join(root, 'recolt.db')))
    expect(db.pragma('user_version', { simple: true })).toBe(0)
  })
})
