/**
 * Tab counters: a single `sum(...)` query, cached per connection and invalidated on each
 * `items.changed` / membership change (also used outside the tabs).
 */
import type Database from 'better-sqlite3'
import type { TabCounts } from '../../../shared/dto/items'

const cache = new WeakMap<Database.Database, TabCounts>()

export function tabCounts(db: Database.Database): TabCounts {
  const hit = cache.get(db)
  if (hit) return hit
  const r = db
    .prepare(
      `SELECT
         coalesce(sum(deleted_at IS NULL AND hidden_at IS NULL), 0) AS "all",
         coalesce(sum(deleted_at IS NULL AND hidden_at IS NULL
           AND EXISTS (SELECT 1 FROM collection_items ci WHERE ci.item_id = items.id)), 0) AS saved,
         coalesce(sum(deleted_at IS NOT NULL), 0) AS trash,
         coalesce(sum(hidden_at IS NOT NULL AND deleted_at IS NULL), 0) AS hidden
       FROM items`,
    )
    .get() as { all: number; saved: number; trash: number; hidden: number }
  const counts: TabCounts = { ...r, unsorted: r.all - r.saved }
  cache.set(db, counts)
  return counts
}

export function invalidateCounts(db?: Database.Database): void {
  if (db) cache.delete(db)
}

/** Virtual source chips `#x #instagram #cosmos`: live items per source. */
export function sourceChips(
  db: Database.Database,
): { source: 'x' | 'instagram' | 'cosmos'; count: number }[] {
  return db
    .prepare(
      `SELECT source, count(*) AS count FROM items
       WHERE deleted_at IS NULL AND hidden_at IS NULL AND source IN ('x', 'instagram', 'cosmos')
       GROUP BY source ORDER BY count DESC, source`,
    )
    .all() as { source: 'x' | 'instagram' | 'cosmos'; count: number }[]
}
