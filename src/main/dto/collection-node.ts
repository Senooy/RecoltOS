/**
 * DTO `CollectionNode` (PLAN §4.3) : arbre, `count` = membres directs non supprimés, `covers` ≤ 3.
 */
import type Database from 'better-sqlite3'
import type { CollectionNode } from '../../shared/dto/collections'
import { cardRowsByUuid } from '../db/queries/list'
import { collectionRows, coverUuids, type CollectionWithCount } from '../db/queries/tree'
import { toItemCard, type DtoLib } from './item-card'

export function collectionTree(lib: DtoLib, db: Database.Database): CollectionNode[] {
  const rows = collectionRows(db)
  const byId = new Map<number, CollectionWithCount>(rows.map((r) => [r.id, r]))
  const nodes = new Map<number, CollectionNode>()
  for (const r of rows) {
    const covers = cardRowsByUuid(db, coverUuids(db, r)).map((c) => toItemCard(lib, c))
    const coverItem = r.cover_item_id
      ? (db.prepare('SELECT uuid FROM items WHERE id = ?').get(r.cover_item_id) as
          { uuid: string } | undefined)
      : undefined
    nodes.set(r.id, {
      uuid: r.uuid,
      name: r.name,
      color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#007aff',
      parentUuid: r.parent_id !== null ? (byId.get(r.parent_id)?.uuid ?? null) : null,
      orderIndex: r.order_index,
      count: r.count,
      covers,
      coverItemUuid: coverItem?.uuid ?? null,
      aiExcluded: r.ai_excluded === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      viewedAt: r.viewed_at,
      children: [],
    })
  }
  const roots: CollectionNode[] = []
  for (const r of rows) {
    const node = nodes.get(r.id)!
    const parent = r.parent_id !== null ? nodes.get(r.parent_id) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** Nœud d'une collection (avec ses enfants). */
export function collectionNode(
  lib: DtoLib,
  db: Database.Database,
  uuid: string,
): CollectionNode | null {
  const find = (list: CollectionNode[]): CollectionNode | null => {
    for (const n of list) {
      if (n.uuid === uuid) return n
      const c = find(n.children)
      if (c) return c
    }
    return null
  }
  return find(collectionTree(lib, db))
}
