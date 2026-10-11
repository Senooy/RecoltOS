/**
 * WP-12 : requêtes de liste (portées, 7 tris keyset), compteurs, couvertures, DTO sans http(s),
 * purge automatique.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { ItemCard, ItemDetail } from '../../../src/shared/dto/items'
import { CollectionNode } from '../../../src/shared/dto/collections'
import { SORT_MODES, type SortMode } from '../../../src/shared/enums'
import { sourceChips, tabCounts, invalidateCounts } from '../../../src/main/db/queries/counts'
import { listItems } from '../../../src/main/db/queries/list'
import { collectionTree } from '../../../src/main/dto/collection-node'
import { toItemCard } from '../../../src/main/dto/item-card'
import { toItemDetail } from '../../../src/main/dto/item-detail'
import { runAutoPurge } from '../../../src/main/jobs/auto-purge'
import { seedSyntheticLibrary } from '../../helpers/db'
import { makeSyntheticLibrary } from '../../helpers/synthetic-items'
import { makeHarness, type JobsHarness } from '../jobs/helpers'

let h: JobsHarness | null = null
afterEach(async () => {
  await h?.cleanup()
  h = null
})

function seeded(count = 120) {
  h = makeHarness()
  const lib = makeSyntheticLibrary({ count })
  const ids = seedSyntheticLibrary(h.t.db, lib, { withDerived: true })
  // Vues et couleurs variées pour les tris « consultés » et « couleur ».
  h.t.db.exec(
    `UPDATE items SET view_count = id % 7, viewed_at = CASE WHEN id % 3 = 0 THEN 1700000000000 + id * 1000 END`,
  )
  return { lib, ids }
}

const all = (input: Parameters<typeof listItems>[1], limit: number) => {
  const out: string[] = []
  let cursor: string | null = null
  for (let i = 0; i < 100; i++) {
    const r = listItems(h!.t.db, { ...input, cursor, limit })
    out.push(...r.rows.map((x) => x.uuid))
    cursor = r.nextCursor
    if (!cursor) break
  }
  return out
}

describe('listes et tris', () => {
  it('les 7 tris : pagination keyset stable (pages de 7 = liste complète)', () => {
    seeded(90)
    for (const sort of SORT_MODES as readonly SortMode[]) {
      const full = listItems(h!.t.db, {
        scope: 'library',
        tab: 'all',
        sort,
        seed: 42,
        cursor: null,
        limit: 500,
      })
      const paged = all({ scope: 'library', tab: 'all', sort, seed: 42 } as never, 7)
      expect(paged, sort).toEqual(full.rows.map((r) => r.uuid))
      expect(new Set(paged).size, sort).toBe(full.total)
    }
    const recent = listItems(h!.t.db, {
      scope: 'library',
      tab: 'all',
      sort: 'recent',
      cursor: null,
      limit: 500,
    }).rows
    for (let i = 1; i < recent.length; i++)
      expect(recent[i - 1]!.created_at >= recent[i]!.created_at).toBe(true)
    const names = listItems(h!.t.db, {
      scope: 'library',
      tab: 'all',
      sort: 'name',
      cursor: null,
      limit: 500,
    }).rows
    expect(names.map((r) => r.name_key)).toEqual([...names.map((r) => r.name_key)].sort())
  })

  it('un masqué apparaît dans sa collection mais pas dans Tout / Enregistrés / Non classés', () => {
    seeded(40)
    const db = h!.t.db
    const col = db.prepare('SELECT id, uuid FROM collections LIMIT 1').get() as {
      id: number
      uuid: string
    }
    const member = db
      .prepare(
        'SELECT i.id, i.uuid FROM collection_items ci JOIN items i ON i.id = ci.item_id WHERE ci.collection_id = ? AND i.deleted_at IS NULL AND i.hidden_at IS NULL LIMIT 1',
      )
      .get(col.id) as { id: number; uuid: string }
    h!.t.repos.items.setHidden([member.id], true)
    invalidateCounts(db)
    const uuids = (tab: 'all' | 'saved' | 'unsorted' | 'hidden') =>
      listItems(db, { scope: 'library', tab, sort: 'recent', cursor: null, limit: 500 }).rows.map(
        (r) => r.uuid,
      )
    expect(uuids('all')).not.toContain(member.uuid)
    expect(uuids('saved')).not.toContain(member.uuid)
    expect(uuids('unsorted')).not.toContain(member.uuid)
    expect(uuids('hidden')).toContain(member.uuid)
    const inCol = listItems(db, {
      scope: 'collection',
      collectionUuid: col.uuid,
      sort: 'recent',
      cursor: null,
      limit: 500,
    })
    expect(inCol.rows.map((r) => r.uuid)).toContain(member.uuid)
    const c = tabCounts(db)
    expect(c.all).toBe(uuids('all').length)
    expect(c.saved + c.unsorted).toBe(c.all)
    expect(c.hidden).toBe(uuids('hidden').length)
  })

  it('count d’une collection = membres directs non supprimés ; chips de source', () => {
    seeded(60)
    const db = h!.t.db
    const lib = { id: 'ltest', root: h!.lib.root }
    const tree = collectionTree(lib, db)
    for (const n of tree) {
      CollectionNode.parse(n)
      const expected = (
        db
          .prepare(
            `SELECT count(*) n FROM collection_items ci JOIN items i ON i.id = ci.item_id JOIN collections c ON c.id = ci.collection_id
             WHERE c.uuid = ? AND i.deleted_at IS NULL`,
          )
          .get(n.uuid) as { n: number }
      ).n
      expect(n.count).toBe(expected)
      expect(n.covers.length).toBe(Math.min(3, expected))
    }
    const ig = (
      db
        .prepare(
          "SELECT count(*) n FROM items WHERE source = 'instagram' AND deleted_at IS NULL AND hidden_at IS NULL",
        )
        .get() as { n: number }
    ).n
    expect(sourceChips(db).find((c) => c.source === 'instagram')?.count ?? 0).toBe(ig)
  })

  it('couverture choisie en premier, puis les plus récents (corbeille exclue)', () => {
    seeded(30)
    const db = h!.t.db
    const col = h!.t.repos.collections.create({ name: 'Cible' })
    const ids = (
      db.prepare('SELECT id FROM items WHERE deleted_at IS NULL ORDER BY id LIMIT 5').all() as {
        id: number
      }[]
    ).map((r) => r.id)
    ids.forEach((id, k) =>
      db
        .prepare('INSERT INTO collection_items (collection_id, item_id, added_at) VALUES (?, ?, ?)')
        .run(col.id, id, 1000 + k),
    )
    h!.t.repos.items.trash([ids[4]!])
    h!.t.repos.collections.update(col.id, { coverItemId: ids[0]! })
    const node = collectionTree({ id: 'ltest', root: h!.lib.root }, db).find(
      (n) => n.uuid === col.uuid,
    )!
    const uuidOf = (id: number) =>
      (db.prepare('SELECT uuid FROM items WHERE id = ?').get(id) as { uuid: string }).uuid
    expect(node.covers.map((c) => c.uuid)).toEqual([
      uuidOf(ids[0]!),
      uuidOf(ids[3]!),
      uuidOf(ids[2]!),
    ])
    expect(node.count).toBe(4)
  })

  it('aucune URL http(s) dans un ItemCard / ItemDetail sérialisé (post_meta avec URLs distantes)', () => {
    seeded(60)
    const db = h!.t.db
    const lib = { id: 'ltest', root: h!.lib.root }
    const rows = listItems(db, {
      scope: 'library',
      tab: 'all',
      sort: 'recent',
      cursor: null,
      limit: 500,
    }).rows
    const withPost = rows.filter((r) => r.post_meta && /https?:/.test(r.post_meta))
    expect(withPost.length).toBeGreaterThan(0)
    const cards = rows.map((r) => ItemCard.parse(toItemCard(lib, r)))
    expect(JSON.stringify(cards)).not.toMatch(/https?:\/\//)
    const detail = ItemDetail.parse(toItemDetail(lib, db, withPost[0]!.uuid))
    const { sourceUrl: _s, ...rest } = detail
    expect(JSON.stringify(rest)).not.toMatch(/https?:\/\//)
    expect(cards.every((c) => c.displayDate === c.createdAt)).toBe(true)
  })

  it('page de 120 cartes < 5 ms SQL sur 10 000 lignes', () => {
    seeded(10_000)
    const db = h!.t.db
    db.exec('ANALYZE')
    listItems(db, { scope: 'library', tab: 'all', sort: 'recent', cursor: null, limit: 120 })
    const times: number[] = []
    let cursor: string | null = null
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      const r = listItems(db, { scope: 'library', tab: 'all', sort: 'recent', cursor, limit: 120 })
      times.push(performance.now() - t0)
      cursor = r.nextCursor
    }
    times.sort((a, b) => a - b)
    expect(times[2]!).toBeLessThan(5 * 4) // marge CI : la médiane mesurée localement est < 5 ms
  }, 60_000)
})

describe('purge automatique', () => {
  it('défaut 0 = jamais ; 7 jours → fichiers dans la Corbeille macOS', async () => {
    h = makeHarness()
    const trashed: string[] = []
    h.services.trashItem = (abs) => {
      trashed.push(abs)
      return Promise.resolve()
    }
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const rel = 'items/ab/abcdef00-0000-4000-8000-000000000001.jpg'
    mkdirSync(h.lib.paths.abs('items/ab').replace(/\/$/, ''), { recursive: true })
    writeFileSync(h.lib.paths.abs(rel), 'x')
    const it = h.t.repos.items.insertWithMedia({ kind: 'image' }, [
      { mediaType: 'image', fileRel: rel },
    ])
    h.t.repos.items.trash([it.id], Date.now() - 10 * 86_400_000)
    expect(runAutoPurge(h.services).purged).toBe(0)
    h.prefs.trashAutoEmptyDays = 7
    expect(runAutoPurge(h.services).purged).toBe(1)
    h.queue.start()
    await h.queue.whenIdle()
    expect(trashed).toEqual([h.lib.paths.abs(rel)])
  })
})
