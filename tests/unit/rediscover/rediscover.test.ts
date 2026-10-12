import { afterEach, describe, expect, it } from 'vitest'
import { createRediscover, UNDO_WINDOW_MS } from '../../../src/main/rediscover/service'
import {
  cooldown,
  drawOrder,
  mulberry32,
  weightOf,
  type Candidate,
} from '../../../src/main/rediscover/select'
import { openTestLib, T0, type TestLib } from '../db/helpers'

const DAY = 86_400_000
const cand = (id: number, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  createdAt: T0 - 200 * DAY,
  viewCount: 0,
  viewedAt: null,
  nCollections: 1,
  lastAction: null,
  lastAt: null,
  ...extra,
})

describe('weights and draw', () => {
  it('unfiled ×2.5, rarely seen, cooldowns keep 90 d / skip 14 d', () => {
    const now = T0
    expect(weightOf(cand(1, { nCollections: 0 }), now) / weightOf(cand(2), now)).toBeCloseTo(2.5)
    expect(weightOf(cand(1, { viewCount: 3 }), now)).toBeLessThan(weightOf(cand(2), now))
    expect(cooldown({ lastAction: 'keep', lastAt: now - 10 * DAY }, now)).toBe(0.1)
    expect(cooldown({ lastAction: 'keep', lastAt: now - 100 * DAY }, now)).toBe(0.6)
    expect(cooldown({ lastAction: 'skip', lastAt: now - 3 * DAY }, now)).toBe(0.15)
    expect(cooldown({ lastAction: 'skip', lastAt: now - 20 * DAY }, now)).toBe(1)
  })

  it('deterministic by seed, complete order without duplicates', () => {
    const c = Array.from({ length: 50 }, (_, i) => cand(i + 1, { nCollections: i % 2 }))
    const a = drawOrder(c, 7, T0)
    expect(drawOrder(c, 7, T0)).toEqual(a)
    expect(new Set(a).size).toBe(50)
    expect(drawOrder(c, 8, T0)).not.toEqual(a)
    expect(mulberry32(1)()).toBeGreaterThanOrEqual(0)
  })

  it('10,000 draws: unfiled items come out more than 2× as often at the top', () => {
    const c = Array.from({ length: 40 }, (_, i) => cand(i + 1, { nCollections: i < 20 ? 0 : 2 }))
    let uncl = 0
    let cl = 0
    for (let seed = 0; seed < 10_000; seed++) {
      for (const id of drawOrder(c, seed, T0).slice(0, 5)) {
        if (id <= 20) uncl++
        else cl++
      }
    }
    expect(uncl / cl).toBeGreaterThan(2)
  })
})

describe('service', () => {
  let t: TestLib | null = null
  afterEach(() => {
    t?.cleanup()
    t = null
  })

  it('paginated deck, logged actions, undo ≤ 10 s, 3 recent collections', () => {
    t = openTestLib()
    const { repos, db } = t
    const ids = Array.from(
      { length: 6 },
      (_, i) => repos.items.insert({ kind: 'image', title: `i${i}` } as never).id,
    )
    const uuid = (id: number) => repos.items.getById(id)!.uuid
    const cols = ['A', 'B', 'C', 'D'].map((name) => repos.collections.create({ name }))
    cols.forEach((c, i) => repos.collections.addItems(c.id, [ids[i]!], T0 + i * 1000))
    const rd = createRediscover()
    let now = T0 + 10_000
    const deps = { db, repos, now: () => now }
    const p1 = rd.deck(deps, { seed: 3, limit: 4, offset: 0 })
    const p2 = rd.deck(deps, { seed: 3, limit: 4, offset: 4 })
    expect(p1.total).toBe(6)
    expect(new Set([...p1.ids, ...p2.ids]).size).toBe(6)
    expect(p1.suggestedCollections.map((c) => c.name)).toEqual(['D', 'C', 'B'])

    const first = p1.ids[0]!
    rd.act(deps, { itemUuid: uuid(first), action: 'keep' })
    expect(db.prepare('SELECT view_count FROM items WHERE id = ?').get(first)).toEqual({
      view_count: 1,
    })
    expect(rd.undo(deps)).toEqual({ itemUuid: uuid(first) })
    expect(db.prepare('SELECT view_count FROM items WHERE id = ?').get(first)).toEqual({
      view_count: 0,
    })
    expect(db.prepare('SELECT count(*) n FROM rediscover_log').get()).toEqual({ n: 0 })

    rd.act(deps, { itemUuid: uuid(first), action: 'trash' })
    expect(db.prepare('SELECT deleted_at FROM items WHERE id = ?').get(first)).not.toEqual({
      deleted_at: null,
    })
    now += UNDO_WINDOW_MS + 1
    expect(rd.undo(deps)).toBeNull()

    const second = p1.ids[1]!
    rd.act(deps, { itemUuid: uuid(second), action: 'collection', collectionUuid: cols[0]!.uuid })
    expect(
      db
        .prepare('SELECT count(*) n FROM collection_items WHERE collection_id = ? AND item_id = ?')
        .get(cols[0]!.id, second),
    ).toEqual({ n: 1 })
    rd.act(deps, { itemUuid: uuid(p1.ids[2]!), action: 'skip' })
    expect(db.prepare('SELECT action FROM rediscover_log ORDER BY id').all()).toEqual([
      { action: 'trash' },
      { action: 'collection' },
      { action: 'skip' },
    ])
    // The next deck drops the trash.
    expect(rd.deck(deps, { seed: 4, limit: 50, offset: 0 }).total).toBe(5)
  })
})
