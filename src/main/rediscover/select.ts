/**
 * Rediscover: weighted draw without replacement (Efraimidis-Spirakis, key
 * `u^(1/w)`, `mulberry32` PRNG seeded with `seed`) over eligible items (neither trashed nor
 * hidden), full order computed once per (seed, scope) then served in pages.
 *
 * Weights: unranked ×2.5; rarely seen `(1 + views)^-0.8`; old `1 + min(2, ln(1 + age/60 d))`;
 * never seen ×1.5, otherwise `min(2, 1 + days since last view / 90)`; cooldown based on the last
 * journal action: keep 0.1 for 90 d then 0.6, skip 0.15 for 14 d. No Electron dependency.
 */
import type Database from 'better-sqlite3'

const DAY = 86_400_000

export interface Candidate {
  id: number
  createdAt: number
  viewCount: number
  viewedAt: number | null
  nCollections: number
  lastAction: 'keep' | 'trash' | 'collection' | 'skip' | null
  lastAt: number | null
}

export function cooldown(c: Pick<Candidate, 'lastAction' | 'lastAt'>, now: number): number {
  if (!c.lastAction || c.lastAt === null) return 1
  const days = (now - c.lastAt) / DAY
  if (c.lastAction === 'keep') return days < 90 ? 0.1 : 0.6
  if (c.lastAction === 'skip') return days < 14 ? 0.15 : 1
  return 1
}

export function weightOf(c: Candidate, now: number): number {
  const ageDays = Math.max(0, (now - c.createdAt) / DAY)
  return (
    (c.nCollections === 0 ? 2.5 : 1) *
    Math.pow(1 + c.viewCount, -0.8) *
    (1 + Math.min(2, Math.log(1 + ageDays / 60))) *
    (c.viewedAt == null ? 1.5 : Math.min(2, 1 + (now - c.viewedAt) / DAY / 90)) *
    cooldown(c, now)
  )
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Full order (ids) by decreasing `u^(1/w)` keys (Efraimidis-Spirakis), deterministic. */
export function drawOrder(cands: readonly Candidate[], seed: number, now: number): number[] {
  const rnd = mulberry32(seed)
  const keyed = cands.map((c) => {
    const w = Math.max(1e-9, weightOf(c, now))
    const u = Math.max(Number.MIN_VALUE, rnd())
    // log(u^(1/w)) = ln(u)/w: same order, without underflow.
    return { id: c.id, k: Math.log(u) / w }
  })
  keyed.sort((a, b) => b.k - a.k || a.id - b.id)
  return keyed.map((x) => x.id)
}

/** Eligible items of the scope (library or collection), with their statistics. */
export function loadCandidates(db: Database.Database, collectionId: number | null): Candidate[] {
  const scope =
    collectionId === null
      ? ''
      : 'AND i.id IN (SELECT item_id FROM collection_items WHERE collection_id = @cid)'
  const rows = db
    .prepare(
      `SELECT i.id, i.created_at, i.view_count, i.viewed_at,
              (SELECT count(*) FROM collection_items ci WHERE ci.item_id = i.id) AS n_col,
              (SELECT action FROM rediscover_log l WHERE l.item_id = i.id
                ORDER BY l.shown_at DESC, l.id DESC LIMIT 1) AS last_action,
              (SELECT shown_at FROM rediscover_log l WHERE l.item_id = i.id
                ORDER BY l.shown_at DESC, l.id DESC LIMIT 1) AS last_at
         FROM items i
        WHERE i.deleted_at IS NULL AND i.hidden_at IS NULL ${scope}`,
    )
    .all(collectionId === null ? {} : { cid: collectionId }) as {
    id: number
    created_at: number
    view_count: number
    viewed_at: number | null
    n_col: number
    last_action: Candidate['lastAction']
    last_at: number | null
  }[]
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    viewCount: r.view_count,
    viewedAt: r.viewed_at,
    nCollections: r.n_col,
    lastAction: r.last_action,
    lastAt: r.last_at,
  }))
}

/** The 3 most recently used collections (`MAX(collection_items.added_at)`). */
export function recentCollections(
  db: Database.Database,
  limit = 3,
): { uuid: string; name: string }[] {
  return db
    .prepare(
      `SELECT c.uuid, c.name FROM collections c
         JOIN collection_items ci ON ci.collection_id = c.id
        GROUP BY c.id ORDER BY MAX(ci.added_at) DESC, c.id DESC LIMIT ?`,
    )
    .all(limit) as { uuid: string; name: string }[]
}
