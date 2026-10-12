/**
 * instantanés (noms, rétention, quotidien), export zip (contenu, items.jsonl,
 * progression), restauration (WAL non vide, pre-restore, abandon si checkpoint bloqué),
 * vérification, stockage, fusion de tags réindexée.
 */
import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportZip, defaultExportName } from '../../../src/main/data/export-zip'
import { quickCheck, restoreSnapshot } from '../../../src/main/data/restore'
import {
  createSnapshot,
  dailySnapshot,
  listSnapshots,
  parseSnapshotName,
  retentionVictims,
} from '../../../src/main/data/snapshots'
import { storageBreakdown } from '../../../src/main/data/storage'
import { verifyLibrary } from '../../../src/main/data/verify'
import { resetLibraryContextForTests } from '../../../src/main/library/library-context'
import {
  createLibraryManager,
  type LibraryManager,
} from '../../../src/main/library/library-manager'
import { zipLibrary } from '../../../src/main/workers/media/files'
import type { SnapshotInfo } from '../../../src/shared/ipc/data'

let base: string
let manager: LibraryManager
const emit = vi.fn()

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-data-')))
  resetLibraryContextForTests()
  emit.mockReset()
  manager = createLibraryManager({
    userData: path.join(base, 'userData'),
    home: path.join(base, 'home'),
    emit,
    busyTimeout: 20,
    checkpointBusyTimeoutMs: 10,
  })
})
afterEach(async () => {
  await manager.close().catch(() => undefined)
  resetLibraryContextForTests()
  fs.rmSync(base, { recursive: true, force: true })
})

const count = (db: Database.Database, sql: string) => (db.prepare(sql).get() as { n: number }).n

/** Élément avec un original réel sous `items/`. */
function addItemWithFile(lib: Awaited<ReturnType<LibraryManager['open']>>, title: string) {
  const it = lib.repos.items.insert({ kind: 'image', title, source: 'local' })
  const uuid = `${it.uuid}`
  const rel = `items/${uuid.slice(0, 2)}/${uuid}.png`
  fs.mkdirSync(path.dirname(lib.paths.abs(rel)), { recursive: true })
  fs.writeFileSync(lib.paths.abs(rel), Buffer.alloc(1024, 7))
  lib.repos.media.insert(it.id, {
    mediaType: 'image',
    status: 'ok',
    fileRel: rel,
    mime: 'image/png',
    width: 10,
    height: 10,
  } as never)
  return { ...it, rel }
}

describe('instantanés', () => {
  it('noms : raison, suffixe de collision retiré, pre-vN conservé', () => {
    expect(parseSnapshotName('recolt-20261011-183000-daily.db')?.reason).toBe('daily')
    expect(parseSnapshotName('recolt-20261011-183000-manual-2.db')?.reason).toBe('manual')
    expect(parseSnapshotName('recolt-20261011-183000-pre-v1.db')?.reason).toBe('pre-v1')
    expect(parseSnapshotName('recolt-20261011-183000.db')?.reason).toBeNull()
    expect(parseSnapshotName('recolt.db')).toBeNull()
    expect(parseSnapshotName('recolt-20261011-183000-daily.db-wal')).toBeNull()
  })

  it('rétention : 7 daily, 20 manuels, pre-* de moins de 30 jours', () => {
    const day = 86_400_000
    const now = 100 * day
    const mk = (reason: string | null, i: number): SnapshotInfo => ({
      name: `${reason ?? 'x'}-${i}`,
      createdAt: now - i * day,
      bytes: 1,
      reason,
    })
    const list = [
      ...Array.from({ length: 10 }, (_, i) => mk('daily', i)),
      ...Array.from({ length: 25 }, (_, i) => mk('manual', i)),
      ...Array.from({ length: 40 }, (_, i) => mk('pre-import', i)),
    ]
    const victims = retentionVictims(list, now)
    expect(victims.filter((v) => v.startsWith('daily'))).toHaveLength(3)
    expect(victims.filter((v) => v.startsWith('manual'))).toHaveLength(5)
    expect(victims.filter((v) => v.startsWith('pre-import'))).toHaveLength(9)
  })

  it('création, liste, quotidien unique par jour', async () => {
    const lib = await manager.open()
    lib.repos.items.insert({ kind: 'image', title: 'a' })
    const s = createSnapshot(lib, 'manual', Date.now())
    expect(s.reason).toBe('manual')
    expect(quickCheck(path.join(lib.paths.dir('snapshots'), s.name))).toBe(true)
    const t = Date.now()
    expect(dailySnapshot(lib, t)).not.toBeNull()
    expect(dailySnapshot(lib, t + 1000)).toBeNull()
    expect(listSnapshots(lib).map((x) => x.reason)).toEqual(
      expect.arrayContaining(['manual', 'daily']),
    )
  })
})

describe('export zip', () => {
  it('manifest, base, originaux, items.jsonl lisible, progression en octets ; collection', async () => {
    const lib = await manager.open()
    const a = addItemWithFile(lib, 'Café du matin')
    const b = addItemWithFile(lib, 'Autre')
    const col = lib.repos.collections.create({ name: 'Ma sélection' })
    lib.repos.collections.addItems(col.id, [a.id])
    lib.repos.tags.addToItems([a.id], ['matin'])
    const progress: { bytesDone: number; bytesTotal: number }[] = []
    const out = path.join(base, 'out', defaultExportName(lib.name, Date.now()))
    fs.mkdirSync(path.dirname(out), { recursive: true })
    const r = await exportZip(
      lib,
      { includeDerived: false },
      out,
      (args, onProgress) => zipLibrary(args, onProgress),
      (p) => progress.push(p),
    )
    expect(r.counts.items).toBe(2)
    execFileSync('unzip', ['-tq', out])
    const listing = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' }).split('\n')
    expect(listing).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'recolt.db',
        'metadata/items.jsonl',
        'metadata/collections.json',
        a.rel,
        b.rel,
      ]),
    )
    const jsonl = execFileSync('unzip', ['-p', out, 'metadata/items.jsonl'], { encoding: 'utf8' })
    const lines = jsonl
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(lines.find((l) => l.title === 'Café du matin')).toMatchObject({
      tags: ['matin'],
      collections: ['Ma sélection'],
    })
    const manifest = JSON.parse(
      execFileSync('unzip', ['-p', out, 'manifest.json'], { encoding: 'utf8' }),
    ) as unknown
    expect(manifest).toMatchObject({ format: 'recoltos-export', version: 1 })
    const last = progress.at(-1)!
    expect(last.bytesDone).toBe(last.bytesTotal)
    expect(last.bytesTotal).toBeGreaterThan(2048)
    // Dossier temporaire nettoyé.
    expect(fs.readdirSync(lib.paths.dir('tmp')).filter((f) => f.startsWith('export-'))).toEqual([])

    // Collection : ses éléments seulement, sans la base.
    const out2 = path.join(base, 'out', 'col.zip')
    await exportZip(
      lib,
      { includeDerived: false, collectionUuid: col.uuid },
      out2,
      (args, p) => zipLibrary(args, p),
      () => undefined,
    )
    const l2 = execFileSync('unzip', ['-Z1', out2], { encoding: 'utf8' })
    expect(l2).toContain(a.rel)
    expect(l2).not.toContain(b.rel)
    expect(l2).not.toContain('recolt.db')
  })
})

describe('restauration', () => {
  it('WAL non vide : aucun -wal résiduel, base = instantané, pre-restore contient les écritures', async () => {
    const lib = await manager.open()
    for (let i = 0; i < 3; i++) lib.repos.items.insert({ kind: 'image', title: `avant ${i}` })
    const snap = createSnapshot(lib, 'manual', Date.now())
    // Écritures après l'instantané, encore dans le WAL.
    for (let i = 0; i < 4; i++) lib.repos.items.insert({ kind: 'image', title: `après ${i}` })
    expect(fs.statSync(lib.paths.wal).size).toBeGreaterThan(0)
    const r = await restoreSnapshot(manager, snap.name)
    const next = manager.active()!
    expect(next.repos.items.countLive()).toBe(3)
    // Aucun ancien WAL rejoué (sinon 7 éléments) ; celui de l'instantané « avant » est vide.
    const preWal = path.join(next.paths.dir('snapshots'), `${r.preRestore}-wal`)
    expect(fs.existsSync(preWal) ? fs.statSync(preWal).size : 0).toBe(0)
    const pre = new Database(path.join(next.paths.dir('snapshots'), r.preRestore), {
      readonly: true,
    })
    expect(count(pre, 'SELECT count(*) n FROM items')).toBe(7)
    pre.close()
    expect(emit).toHaveBeenLastCalledWith('library.switched', { libraryId: 'default' })
    // FTS reconstruite.
    expect(next.repos.search.match('"avant"*').length).toBe(3)
  })

  it('checkpoint bloqué par un lecteur : abandon propre, rien n’a bougé', async () => {
    const lib = await manager.open()
    lib.repos.items.insert({ kind: 'image', title: 'x' })
    const snap = createSnapshot(lib, 'manual', Date.now())
    lib.repos.items.insert({ kind: 'image', title: 'y' })
    const reader = new Database(lib.paths.db)
    reader.exec('BEGIN')
    reader.prepare('SELECT count(*) FROM items').get()
    await expect(restoreSnapshot(manager, snap.name)).rejects.toMatchObject({
      code: 'wal_not_empty',
    })
    reader.exec('COMMIT')
    reader.close()
    expect(manager.active()!.repos.items.countLive()).toBe(2)
    expect(listSnapshots(manager.active()!).some((s) => s.reason === 'pre-restore')).toBe(false)
    expect(fs.readdirSync(lib.paths.dir('tmp')).filter((f) => f.startsWith('restore-'))).toEqual([])
  })

  it('instantané endommagé : refusé avant toute modification', async () => {
    const lib = await manager.open()
    const bad = path.join(lib.paths.dir('snapshots'), 'recolt-20260101-000000-manual.db')
    fs.writeFileSync(bad, 'pas une base')
    await expect(restoreSnapshot(manager, path.basename(bad))).rejects.toMatchObject({
      code: 'validation',
    })
    expect(manager.active()).not.toBeNull()
  })
})

describe('vérification, stockage, tags', () => {
  it('original disparu → missing ; fichier orphelin signalé ; tailles par dossier', async () => {
    const lib = await manager.open()
    const a = addItemWithFile(lib, 'a')
    fs.rmSync(lib.paths.abs(a.rel))
    fs.writeFileSync(path.join(lib.paths.dir('items'), 'orphelin.bin'), 'x')
    const r = verifyLibrary(lib, { fix: true })
    expect(r.ok).toBe(false)
    expect(r.issues.map((i) => i.code).sort()).toEqual(['missing_original', 'orphan_file'])
    expect(count(lib.db, "SELECT count(*) n FROM item_media WHERE status = 'missing'")).toBe(1)
    const s = await storageBreakdown(lib)
    expect(s.items).toBe(1)
    expect(s.database).toBeGreaterThan(0)
    expect(s.total).toBeGreaterThanOrEqual(s.items + s.database)
  })

  it('fusion de deux tags : liens réaffectés et FTS réindexée', async () => {
    const lib = await manager.open()
    const a = lib.repos.items.insert({ kind: 'image', title: 'a' }).id
    const b = lib.repos.items.insert({ kind: 'image', title: 'b' }).id
    const [t1] = lib.repos.tags.addToItems([a], ['chat'])
    const [t2] = lib.repos.tags.addToItems([b], ['chats'])
    lib.repos.tags.merge([t2!], t1!)
    expect(count(lib.db, 'SELECT count(*) n FROM item_tags WHERE tag_id = ' + String(t1))).toBe(2)
    expect(lib.repos.search.match('tags:chats').length).toBe(0)
    expect(
      lib.repos.search
        .match('tags:chat')
        .map((h) => h.id)
        .sort(),
    ).toEqual([a, b].sort())
  })
})
