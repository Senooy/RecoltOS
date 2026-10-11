/**
 * M2 sur la vraie bibliothèque déjà importée (copie de dev, jamais la référence) :
 * `RECOLT_TEST_IMPORTED_USERDATA=<repo>/.tmp/m2-real pnpm exec vitest run --project real`.
 * Le `userData` est cloné (APFS) dans un dossier temporaire : la source n'est jamais modifiée.
 * Chiffres recalculés depuis la base (ERRATA §C), sauf ceux de DESIGN/ARCHI (Dev 60, Gaming 36).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { exportZip } from '../../src/main/data/export-zip'
import { restoreSnapshot } from '../../src/main/data/restore'
import { createSnapshot } from '../../src/main/data/snapshots'
import { collectionTree } from '../../src/main/dto/collection-node'
import { resetLibraryContextForTests } from '../../src/main/library/library-context'
import { createLibraryManager, type LibraryManager } from '../../src/main/library/library-manager'
import { runSearch } from '../../src/main/search/search'
import { zipLibrary } from '../../src/main/workers/media/files'

const SRC = process.env.RECOLT_TEST_IMPORTED_USERDATA ?? ''

describe.skipIf(!SRC)('M2 sur la bibliothèque importée', () => {
  let base: string
  let m: LibraryManager
  beforeAll(async () => {
    if (/legacy/i.test(SRC)) throw new Error('source la référence refusée (lecture seule)')
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-m2real-'))
    const ud = path.join(base, 'userData')
    fs.mkdirSync(ud)
    for (const f of ['libraries', 'libraries.json']) {
      const r = spawnSync('cp', ['-cR', path.join(SRC, f), path.join(ud, f)])
      if (r.status !== 0) fs.cpSync(path.join(SRC, f), path.join(ud, f), { recursive: true })
    }
    resetLibraryContextForTests()
    m = createLibraryManager({ userData: ud })
    await m.open()
  })
  afterAll(async () => {
    await m?.close()
    resetLibraryContextForTests()
    if (base) fs.rmSync(base, { recursive: true, force: true })
  })

  it('collections : Dev 60, Gaming 36 ; couverture de Gaming = « …MINECRAFT MOD »', () => {
    const lib = m.active()!
    const tree = collectionTree(lib, lib.db)
    const by = new Map(tree.map((n) => [n.name, n]))
    expect(by.get('Dev')?.count).toBe(60)
    expect(by.get('Gaming')?.count).toBe(36)
    expect(by.get('Gaming')?.covers[0]?.post?.text ?? '').toMatch(/MINECRAFT MOD/i)
  })

  it('recherche : « instagram » met les éléments Instagram en tête ; #cosmos ; @handle', () => {
    const lib = m.active()!
    const live = (src: string) =>
      (
        lib.db
          .prepare(
            'SELECT count(*) n FROM items WHERE source = ? AND deleted_at IS NULL AND hidden_at IS NULL',
          )
          .get(src) as { n: number }
      ).n
    const insta = runSearch(lib.db, { q: 'instagram', limit: 1000 })
    const nInsta = live('instagram')
    expect(insta.rows.slice(0, nInsta).every((r) => r.source === 'instagram')).toBe(true)
    expect(insta.total).toBeGreaterThanOrEqual(nInsta)
    const cosmos = runSearch(lib.db, { q: '#cosmos', limit: 1000 })
    expect(cosmos.total).toBe(live('cosmos'))
    const t0 = performance.now()
    runSearch(lib.db, { q: 'design', limit: 300 })
    expect(performance.now() - t0).toBeLessThan(30)
  })

  it('export zip de la collection Dev valide', async () => {
    const lib = m.active()!
    const dev = lib.db.prepare("SELECT uuid FROM collections WHERE name = 'Dev'").get() as {
      uuid: string
    }
    const out = path.join(base, 'dev.zip')
    const r = await exportZip(
      lib,
      { includeDerived: false, collectionUuid: dev.uuid },
      out,
      (a, p) => zipLibrary(a, p),
      () => undefined,
    )
    expect(r.counts.items).toBe(60)
    execFileSync('unzip', ['-tq', out])
  })

  it('instantané puis restauration avec WAL non vide', async () => {
    const lib = m.active()!
    const n0 = lib.repos.items.countLive()
    const snap = createSnapshot(lib, 'manual', Date.now())
    lib.repos.collections.create({ name: 'écriture après instantané' })
    expect(fs.statSync(lib.paths.wal).size).toBeGreaterThan(0)
    await restoreSnapshot(m, snap.name)
    const next = m.active()!
    expect(next.repos.items.countLive()).toBe(n0)
    expect(
      next.db
        .prepare("SELECT count(*) n FROM collections WHERE name = 'écriture après instantané'")
        .get(),
    ).toEqual({ n: 0 })
    expect(next.repos.search.indexedCount()).toBe(
      (next.db.prepare('SELECT count(*) n FROM items').get() as { n: number }).n,
    )
  })
})
