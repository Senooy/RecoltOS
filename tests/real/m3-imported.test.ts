/**
 * Colors, Rediscover and search on a COPY of a real RecoltOS `userData`:
 * `RECOLT_TEST_IMPORTED_USERDATA=<repo>/.tmp/m3-real pnpm exec vitest run --project real`.
 * APFS copy into a temporary folder (migration 0002 applies to it, the source stays intact).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPaletteIndex } from '../../src/main/color/palette-index'
import { queryFromHex, searchColors } from '../../src/main/color/color-search'
import { listItems } from '../../src/main/db/queries/list'
import { resetLibraryContextForTests } from '../../src/main/library/library-context'
import { createLibraryManager, type LibraryManager } from '../../src/main/library/library-manager'
import { drawOrder, loadCandidates } from '../../src/main/rediscover/select'
import { runSearch } from '../../src/main/search/search'
import { NAMED_COLORS, hexToLab, labToLch } from '../../src/shared/color'

const SRC = process.env.RECOLT_TEST_IMPORTED_USERDATA ?? ''

describe.skipIf(!SRC)('M3 on the imported library', () => {
  let base: string
  let m: LibraryManager
  beforeAll(async () => {
    if (/application support/i.test(SRC)) throw new Error('live folder refused: pass a copy')
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-m3real-'))
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

  it('migration 0002: shifted buckets, no live item without palette after derivations', () => {
    const db = m.active()!.db
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(2)
    const live = 'deleted_at IS NULL AND hidden_at IS NULL'
    expect(
      db.prepare(`SELECT count(*) n FROM items WHERE ${live} AND color_bucket = 13`).get(),
    ).toEqual({
      n: 0,
    })
    const rows = db
      .prepare(`SELECT color_c c, color_h h, color_bucket b FROM items WHERE color_c >= 12`)
      .all() as { c: number; h: number; b: number }[]
    expect(rows.length).toBeGreaterThan(100)
    for (const r of rows) expect(r.b).toBe(Math.floor(((Math.trunc(r.h) + 15) % 360) / 30))
    // Color sort: unknowns (if any) at the end, order follows color_key.
    const page = listItems(db, {
      scope: 'library',
      tab: 'all',
      sort: 'color',
      cursor: null,
      limit: 500,
    })
    expect(page.rows.length).toBe(
      (db.prepare(`SELECT count(*) n FROM items WHERE ${live}`).get() as { n: number }).n,
    )
  })

  it('"red" filter: items dominated by red, < 2 ms on the real index', () => {
    const db = m.active()!.db
    const red = NAMED_COLORS[0]!
    const r = runSearch(db, { q: '', filters: { colors: [red.hex] }, limit: 1000 })
    expect(r.total).toBeGreaterThan(5)
    // The first strong color of each top result is reddish (hue ≤ 60° or ≥ 330°).
    for (const row of r.rows.slice(0, 10)) {
      const pal = JSON.parse(
        (
          db.prepare('SELECT palette FROM items WHERE uuid = ?').get(row.uuid) as {
            palette: string
          }
        ).palette,
      ) as string[]
      const hues = pal.map((h) => labToLch(hexToLab(h))).filter((l) => l[1] >= 20)
      expect(hues.some((l) => l[2] <= 60 || l[2] >= 330)).toBe(true)
    }
    const idx = getPaletteIndex(db)
    const q = [queryFromHex(red.hex)]
    for (let i = 0; i < 20; i++) searchColors(idx, q)
    const t0 = performance.now()
    searchColors(idx, q)
    expect(performance.now() - t0).toBeLessThan(2)
  })

  it('Rediscover: 10,000 draws, unclassified items come up > 2× more often (per item)', () => {
    const db = m.active()!.db
    const cands = loadCandidates(db, null)
    const uncl = new Set(cands.filter((c) => c.nCollections === 0).map((c) => c.id))
    expect(uncl.size).toBeGreaterThan(10)
    const now = Date.now()
    let hitsU = 0
    let hitsC = 0
    for (let seed = 0; seed < 10_000; seed++) {
      for (const id of drawOrder(cands, seed, now).slice(0, 10)) {
        if (uncl.has(id)) hitsU++
        else hitsC++
      }
    }
    const rateU = hitsU / uncl.size
    const rateC = hitsC / (cands.length - uncl.size)
    expect(rateU / rateC).toBeGreaterThan(2)
  })
})
