/**
 * Repo `collections` + `collection_items` (ARCHI §4.3, §7) : API d'écriture gelée.
 * - cycles refusés par CTE récursive avant tout changement de parent (`collection_cycle`) ;
 * - suppression : pierres tombales explicites des descendants d'origine `gatheros` (la cascade
 *   sur une table auto-référencée ne déclenche pas forcément `trg_tomb_collection`) ;
 * - retrait d'appartenance : `trg_tomb_membership` pose la pierre tombale.
 */
import type Database from 'better-sqlite3'
import { AppError } from '../../../shared/errors'
import { newUuid } from '../../../shared/ids'
import { buildSet, idList, repoBase, type ColumnSpec, type RepoOptions } from './util'

export interface CollectionRow {
  id: number
  uuid: string
  parent_id: number | null
  name: string
  color: string
  cover_item_id: number | null
  order_index: number
  ai_excluded: number
  origin: string
  origin_id: string | null
  created_at: number
  updated_at: number
  viewed_at: number | null
}

export interface NewCollection {
  name: string
  uuid?: string
  parentId?: number | null
  color?: string
  coverItemId?: number | null
  /** Défaut : après le dernier frère. */
  orderIndex?: number
  aiExcluded?: boolean
  origin?: string
  originId?: string | null
  createdAt?: number
  updatedAt?: number
  viewedAt?: number | null
}

export interface CollectionPatch {
  name?: string
  color?: string
  coverItemId?: number | null
  parentId?: number | null
  orderIndex?: number
  aiExcluded?: boolean
  viewedAt?: number | null
}

const COLUMNS: Readonly<Record<keyof CollectionPatch, ColumnSpec>> = {
  name: { col: 'name' },
  color: { col: 'color' },
  coverItemId: { col: 'cover_item_id' },
  parentId: { col: 'parent_id' },
  orderIndex: { col: 'order_index' },
  aiExcluded: { col: 'ai_excluded', kind: 'bool' },
  viewedAt: { col: 'viewed_at' },
}

export const DEFAULT_COLLECTION_COLOR = '#007aff'
/** Écart minimal entre deux `order_index` avant renumérotation des frères. */
const MIN_ORDER_GAP = 1e-6

export interface CollectionUpsertResult {
  status: 'created' | 'existing' | 'tombstoned'
  id: number | null
  uuid: string | null
}

export function createCollectionsRepo(db: Database.Database, opts: RepoOptions = {}) {
  const { q, now } = repoBase(db, opts)

  const getById = (id: number) =>
    q('SELECT * FROM collections WHERE id = ?').get(id) as CollectionRow | undefined

  const requireById = (id: number): CollectionRow => {
    const row = getById(id)
    if (!row) throw new AppError('not_found', 'Collection introuvable.')
    return row
  }

  const siblingsOf = (parentId: number | null): CollectionRow[] =>
    q('SELECT * FROM collections WHERE parent_id IS ? ORDER BY order_index, id').all(
      parentId,
    ) as CollectionRow[]

  const nextOrder = (parentId: number | null): number =>
    (
      q('SELECT coalesce(max(order_index), 0) + 1 AS o FROM collections WHERE parent_id IS ?').get(
        parentId,
      ) as { o: number }
    ).o

  /** Ids des descendants (sans la collection elle-même). */
  const descendantIds = (id: number): number[] =>
    (
      q(
        `WITH RECURSIVE d(id) AS (
           SELECT id FROM collections WHERE parent_id = ?
           UNION SELECT c.id FROM collections c JOIN d ON c.parent_id = d.id)
         SELECT id FROM d ORDER BY id`,
      ).all(id) as { id: number }[]
    ).map((r) => r.id)

  /** Refuse un parent égal à la collection ou à l'un de ses descendants (CTE des ancêtres). */
  const assertNoCycle = (id: number, newParentId: number | null): void => {
    if (newParentId === null) return
    if (newParentId === id) {
      throw new AppError('collection_cycle', 'Une collection ne peut pas se contenir elle-même.')
    }
    const hit = q(
      `WITH RECURSIVE a(id) AS (
         SELECT ?
         UNION SELECT c.parent_id FROM collections c JOIN a ON c.id = a.id
         WHERE c.parent_id IS NOT NULL)
       SELECT 1 FROM a WHERE id = ?`,
    ).get(newParentId, id)
    if (hit) {
      throw new AppError(
        'collection_cycle',
        'Impossible de déplacer une collection dans une de ses sous-collections.',
      )
    }
  }

  /** Un nom de collection ne peut pas être vide (après rognage des espaces). */
  const assertName = (name: string): void => {
    if (name.trim() === '') {
      throw new AppError('validation', 'Le nom de la collection ne peut pas être vide.')
    }
  }

  const create = (c: NewCollection): { id: number; uuid: string } => {
    assertName(c.name)
    const at = now()
    const uuid = c.uuid ?? newUuid()
    const parentId = c.parentId ?? null
    if (parentId !== null) requireById(parentId)
    const r = q(
      `INSERT INTO collections (uuid, parent_id, name, color, cover_item_id, order_index,
         ai_excluded, origin, origin_id, created_at, updated_at, viewed_at)
       VALUES (@uuid, @parent_id, @name, @color, @cover_item_id, @order_index, @ai_excluded,
         @origin, @origin_id, @created_at, @updated_at, @viewed_at)`,
    ).run({
      uuid,
      parent_id: parentId,
      name: c.name,
      color: c.color ?? DEFAULT_COLLECTION_COLOR,
      cover_item_id: c.coverItemId ?? null,
      order_index: c.orderIndex ?? nextOrder(parentId),
      ai_excluded: c.aiExcluded ? 1 : 0,
      origin: c.origin ?? 'app',
      origin_id: c.originId ?? null,
      created_at: c.createdAt ?? at,
      updated_at: c.updatedAt ?? c.createdAt ?? at,
      viewed_at: c.viewedAt ?? null,
    })
    return { id: Number(r.lastInsertRowid), uuid }
  }

  const update = (id: number, patch: CollectionPatch): boolean => {
    return db.transaction(() => {
      requireById(id)
      if (patch.name !== undefined) assertName(patch.name)
      if (patch.parentId !== undefined) {
        if (patch.parentId !== null) requireById(patch.parentId)
        assertNoCycle(id, patch.parentId)
      }
      const set = buildSet(patch, COLUMNS)
      if (!set) return false
      return (
        q(`UPDATE collections SET ${set.sql}, updated_at = @updated_at WHERE id = @id`).run({
          ...set.params,
          updated_at: now(),
          id,
        }).changes > 0
      )
    })()
  }

  const addItems = (collectionId: number, itemIds: readonly number[], at: number = now()) =>
    db.transaction(() => {
      requireById(collectionId)
      const stmt = q(
        'INSERT OR IGNORE INTO collection_items (collection_id, item_id, added_at) VALUES (?, ?, ?)',
      )
      let n = 0
      for (const itemId of itemIds) n += stmt.run(collectionId, itemId, at).changes
      return n
    })()

  const removeItems = (collectionId: number, itemIds: readonly number[]): number =>
    q(
      `DELETE FROM collection_items
       WHERE collection_id = ? AND item_id IN (SELECT value FROM json_each(?))`,
    ).run(collectionId, idList(itemIds)).changes

  return {
    create,

    /** Idempotent par `(origin, origin_id)` ; une collection en pierre tombale n'est pas recréée. */
    upsertByOrigin(
      c: NewCollection & { origin: string; originId: string },
      options: { respectTombstones?: boolean } = {},
    ): CollectionUpsertResult {
      return db.transaction((): CollectionUpsertResult => {
        const existing = q(
          'SELECT id, uuid FROM collections WHERE origin = ? AND origin_id = ?',
        ).get(c.origin, c.originId) as { id: number; uuid: string } | undefined
        if (existing) return { status: 'existing', ...existing }
        if (options.respectTombstones !== false) {
          const tomb = q(
            `SELECT 1 FROM import_tombstones
             WHERE origin = ? AND entity = 'collection' AND origin_id = ?`,
          ).get(c.origin, c.originId)
          if (tomb) return { status: 'tombstoned', id: null, uuid: null }
        }
        return { status: 'created', ...create(c) }
      })()
    },

    update,

    /** Change le parent (cycle refusé). `null` = racine. */
    setParent(id: number, parentId: number | null): boolean {
      return update(id, { parentId })
    },

    assertNoCycle,
    descendantIds,

    /**
     * Supprime une collection. `keepChildren` : les sous-collections remontent d'un niveau.
     * Sinon : pierres tombales (origine `gatheros`) de la collection et de TOUS ses descendants,
     * puis `DELETE` (cascade). Renvoie le nombre de collections supprimées.
     */
    delete(id: number, options: { keepChildren?: boolean } = {}): number {
      return db.transaction(() => {
        const row = requireById(id)
        const at = now()
        let ids = [id]
        if (options.keepChildren) {
          q('UPDATE collections SET parent_id = ?, updated_at = ? WHERE parent_id = ?').run(
            row.parent_id,
            at,
            id,
          )
        } else {
          ids = [id, ...descendantIds(id)]
        }
        q(
          `INSERT OR IGNORE INTO import_tombstones (origin, entity, origin_id, removed_at)
           SELECT 'gatheros', 'collection', origin_id, @at FROM collections
           WHERE id IN (SELECT value FROM json_each(@list))
             AND origin = 'gatheros' AND origin_id IS NOT NULL`,
        ).run({ at, list: idList(ids) })
        q('DELETE FROM collections WHERE id = ?').run(id)
        return ids.length
      })()
    },

    /**
     * Place `id` juste avant `beforeId` parmi ses frères (ou en dernier si `null`).
     * `order_index` REAL : milieu des voisins, renumérotation 1..n si l'écart devient trop faible.
     */
    reorder(id: number, beforeId: number | null): void {
      db.transaction(() => {
        const row = requireById(id)
        const at = now()
        const siblings = siblingsOf(row.parent_id).filter((s) => s.id !== id)
        let index: number
        if (beforeId === null) {
          index = (siblings.at(-1)?.order_index ?? 0) + 1
        } else {
          const pos = siblings.findIndex((s) => s.id === beforeId)
          if (pos < 0) throw new AppError('not_found', 'Collection de référence introuvable.')
          const next = siblings[pos]!.order_index
          const prev = pos > 0 ? siblings[pos - 1]!.order_index : next - 2
          index = (prev + next) / 2
          if (next - prev < MIN_ORDER_GAP) {
            const ordered = [...siblings.slice(0, pos), row, ...siblings.slice(pos)]
            const stmt = q('UPDATE collections SET order_index = ?, updated_at = ? WHERE id = ?')
            ordered.forEach((s, i) => stmt.run(i + 1, at, s.id))
            return
          }
        }
        q('UPDATE collections SET order_index = ?, updated_at = ? WHERE id = ?').run(index, at, id)
      })()
    },

    /** Ajoute des items (doublons ignorés) ; renvoie le nombre d'appartenances créées. */
    addItems,
    /** Retire des items ; `trg_tomb_membership` pose les pierres tombales d'import. */
    removeItems,
    /** Déplace des items d'une collection vers une autre (retrait + ajout, une transaction). */
    moveItems(
      fromId: number,
      toId: number,
      itemIds: readonly number[],
      at: number = now(),
    ): number {
      // Même collection : rien à faire (retirer puis rajouter poserait une pierre tombale sur un
      // membre vivant).
      if (fromId === toId) return 0
      return db.transaction(() => {
        removeItems(fromId, itemIds)
        return addItems(toId, itemIds, at)
      })()
    },

    getById,
    getByUuid(uuid: string): CollectionRow | undefined {
      return q('SELECT * FROM collections WHERE uuid = ?').get(uuid) as CollectionRow | undefined
    },
    idByUuid(uuid: string): number | undefined {
      return (
        q('SELECT id FROM collections WHERE uuid = ?').get(uuid) as { id: number } | undefined
      )?.id
    },
    children(parentId: number | null): CollectionRow[] {
      return siblingsOf(parentId)
    },
    itemIds(collectionId: number): number[] {
      return (
        q('SELECT item_id FROM collection_items WHERE collection_id = ? ORDER BY item_id').all(
          collectionId,
        ) as { item_id: number }[]
      ).map((r) => r.item_id)
    },
    markViewed(id: number, at: number = now()): boolean {
      return q('UPDATE collections SET viewed_at = ? WHERE id = ?').run(at, id).changes > 0
    },
  }
}

export type CollectionsRepo = ReturnType<typeof createCollectionsRepo>
