/**
 * Base `spaces` + `space_nodes` repo (full schema from 0001). The Spaces domain
 * (`src/main/spaces/repo.ts`, `applyBatch` batches, assets, GC) relies on these primitives.
 */
import type Database from 'better-sqlite3'
import { newUuid } from '../../../shared/ids'
import { repoBase, type RepoOptions } from './util'

export interface SpaceRow {
  id: number
  uuid: string
  name: string
  viewport: string
  background: 'dots' | 'grid' | 'plain'
  thumb_rel: string | null
  thumb_updated_at: number | null
  order_index: number
  origin: string
  origin_id: string | null
  created_at: number
  updated_at: number
  viewed_at: number | null
  deleted_at: number | null
}

export type SpaceNodeType = 'item' | 'image' | 'note' | 'shape' | 'text'

export interface SpaceNodeRow {
  id: number
  uuid: string
  space_id: number
  type: SpaceNodeType
  item_id: number | null
  asset_rel: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  z: number
  locked: number
  content: string | null
  style: string
  created_at: number
  updated_at: number
}

export interface SpaceNodeInput {
  uuid: string
  type: SpaceNodeType
  itemId?: number | null
  assetRel?: string | null
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  z?: number
  locked?: boolean
  content?: string | null
  style?: Record<string, unknown>
}

export function createSpacesRepo(db: Database.Database, opts: RepoOptions = {}) {
  const { q, now } = repoBase(db, opts)

  const touch = (spaceId: number, at: number) =>
    q('UPDATE spaces SET updated_at = ? WHERE id = ?').run(at, spaceId)

  return {
    create(
      s: { name?: string; uuid?: string; origin?: string; originId?: string | null } = {},
      at: number = now(),
    ): { id: number; uuid: string } {
      const uuid = s.uuid ?? newUuid()
      const r = q(
        `INSERT INTO spaces (uuid, name, origin, origin_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(uuid, s.name ?? '', s.origin ?? 'app', s.originId ?? null, at, at)
      return { id: Number(r.lastInsertRowid), uuid }
    },
    getByUuid(uuid: string): SpaceRow | undefined {
      return q('SELECT * FROM spaces WHERE uuid = ?').get(uuid) as SpaceRow | undefined
    },
    /** Live spaces, from most recently modified to oldest. */
    list(): SpaceRow[] {
      return q(
        'SELECT * FROM spaces WHERE deleted_at IS NULL ORDER BY updated_at DESC, id DESC',
      ).all() as SpaceRow[]
    },
    update(
      id: number,
      patch: {
        name?: string
        viewport?: { x: number; y: number; zoom: number }
        background?: SpaceRow['background']
      },
      at: number = now(),
    ): boolean {
      return (
        q(
          `UPDATE spaces SET name = coalesce(@name, name), viewport = coalesce(@viewport, viewport),
             background = coalesce(@background, background), updated_at = @at WHERE id = @id`,
        ).run({
          id,
          at,
          name: patch.name ?? null,
          viewport: patch.viewport ? JSON.stringify(patch.viewport) : null,
          background: patch.background ?? null,
        }).changes > 0
      )
    },
    softDelete(id: number, at: number = now()): boolean {
      return (
        q('UPDATE spaces SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(at, id)
          .changes > 0
      )
    },
    /** Permanent deletion (nodes cascade). */
    delete(id: number): boolean {
      return q('DELETE FROM spaces WHERE id = ?').run(id).changes > 0
    },

    /** Creates or replaces nodes by `uuid` (one transaction). */
    upsertNodes(spaceId: number, nodes: readonly SpaceNodeInput[], at: number = now()): number {
      return db.transaction(() => {
        const stmt = q(
          `INSERT INTO space_nodes (uuid, space_id, type, item_id, asset_rel, x, y, width, height,
             rotation, z, locked, content, style, created_at, updated_at)
           VALUES (@uuid, @space_id, @type, @item_id, @asset_rel, @x, @y, @width, @height,
             @rotation, @z, @locked, @content, @style, @at, @at)
           ON CONFLICT (uuid) DO UPDATE SET
             type = excluded.type, item_id = excluded.item_id, asset_rel = excluded.asset_rel,
             x = excluded.x, y = excluded.y, width = excluded.width, height = excluded.height,
             rotation = excluded.rotation, z = excluded.z, locked = excluded.locked,
             content = excluded.content, style = excluded.style, updated_at = excluded.updated_at
           WHERE space_nodes.space_id = excluded.space_id`,
        )
        let n = 0
        for (const node of nodes) {
          n += stmt.run({
            uuid: node.uuid,
            space_id: spaceId,
            type: node.type,
            item_id: node.itemId ?? null,
            asset_rel: node.assetRel ?? null,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            rotation: node.rotation ?? 0,
            z: node.z ?? 0,
            locked: node.locked ? 1 : 0,
            content: node.content ?? null,
            style: JSON.stringify(node.style ?? {}),
            at,
          }).changes
        }
        if (nodes.length > 0) touch(spaceId, at)
        return n
      })()
    },
    deleteNodes(spaceId: number, uuids: readonly string[], at: number = now()): number {
      return db.transaction(() => {
        const n = q(
          'DELETE FROM space_nodes WHERE space_id = ? AND uuid IN (SELECT value FROM json_each(?))',
        ).run(spaceId, JSON.stringify(uuids)).changes
        if (n > 0) touch(spaceId, at)
        return n
      })()
    },
    listNodes(spaceId: number): SpaceNodeRow[] {
      return q('SELECT * FROM space_nodes WHERE space_id = ? ORDER BY z, id').all(
        spaceId,
      ) as SpaceNodeRow[]
    },
  }
}

export type SpacesRepo = ReturnType<typeof createSpacesRepo>
