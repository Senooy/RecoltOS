/**
 * Redécouvrir (AI §10, PLAN §1.10) : tirage pondéré sans remise (Efraimidis-Spirakis, clé
 * `u^(1/w)`, PRNG `mulberry32` de graine `seed`) sur les éléments éligibles (ni corbeille ni
 * masqués), ordre complet calculé une fois par (graine, portée) puis servi par pages.
 *
 * Poids : non classés ×2,5 ; peu vus `(1 + vues)^-0,8` ; anciens `1 + min(2, ln(1 + âge/60 j))` ;
 * jamais vus ×1,5 sinon `min(2, 1 + jours depuis la dernière vue / 90)` ; cooldown selon la dernière
 * action du journal : keep 0,1 pendant 90 j puis 0,6, skip 0,15 pendant 14 j. Sans dépendance Electron.
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

/** Ordre complet (ids) par clés `u^(1/w)` décroissantes (Efraimidis-Spirakis), déterministe. */
export function drawOrder(cands: readonly Candidate[], seed: number, now: number): number[] {
  const rnd = mulberry32(seed)
  const keyed = cands.map((c) => {
    const w = Math.max(1e-9, weightOf(c, now))
    const u = Math.max(Number.MIN_VALUE, rnd())
    // log(u^(1/w)) = ln(u)/w : même ordre, sans sous-dépassement.
    return { id: c.id, k: Math.log(u) / w }
  })
  keyed.sort((a, b) => b.k - a.k || a.id - b.id)
  return keyed.map((x) => x.id)
}

/** Éligibles de la portée (bibliothèque ou collection) avec leurs statistiques. */
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

/** Les 3 collections les plus récemment utilisées (`MAX(collection_items.added_at)`, ERRATA §G). */
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
