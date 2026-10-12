/**
 * Collection tree: `count` = direct members not deleted (hidden ones
 * included); covers ≤ 3 = `cover_item_id`, then
 * `ORDER BY collection_items.added_at DESC, items.id DESC`, members in the trash excluded.
 */
import type Database from 'better-sqlite3'
import type { CollectionRow } from '../repos/collections'

export interface CollectionWithCount extends CollectionRow {
  count: number
}

export function collectionRows(db: Database.Database): CollectionWithCount[] {
  return db
    .prepare(
      `SELECT c.*, (SELECT count(*) FROM collection_items ci JOIN items i ON i.id = ci.item_id
                    WHERE ci.collection_id = c.id AND i.deleted_at IS NULL) AS count
       FROM collections c ORDER BY c.order_index, c.id`,
    )
    .all() as CollectionWithCount[]
}

/** Uuids of a collection's covers (≤ 3), the chosen cover first. */
export function coverUuids(
  db: Database.Database,
  c: Pick<CollectionRow, 'id' | 'cover_item_id'>,
  n = 3,
): string[] {
  const out: string[] = []
  if (c.cover_item_id !== null) {
    const cover = db
      .prepare('SELECT uuid FROM items WHERE id = ? AND deleted_at IS NULL')
      .get(c.cover_item_id) as { uuid: string } | undefined
    if (cover) out.push(cover.uuid)
  }
  const rows = db
    .prepare(
      `SELECT i.uuid FROM collection_items ci JOIN items i ON i.id = ci.item_id
       WHERE ci.collection_id = ? AND i.deleted_at IS NULL AND i.id IS NOT ?
       ORDER BY ci.added_at DESC, i.id DESC LIMIT ?`,
    )
    .all(c.id, c.cover_item_id, n) as { uuid: string }[]
  for (const r of rows) if (out.length < n) out.push(r.uuid)
  return out
}
