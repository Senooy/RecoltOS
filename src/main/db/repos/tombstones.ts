/**
 * Import tombstones: what the user removed from an import is never
 * recreated by a re-import. The triggers in 0001 set those for direct deletions;
 * `collections.delete` explicitly sets those for descendants.
 */
import type Database from 'better-sqlite3'
import { repoBase, type RepoOptions } from './util'

export type TombstoneEntity = 'item' | 'collection' | 'membership'

/** Key of a membership: `<collectionOriginId>:<itemOriginId>`. */
export function membershipKey(collectionOriginId: string, itemOriginId: string): string {
  return `${collectionOriginId}:${itemOriginId}`
}

export function createTombstonesRepo(db: Database.Database, opts: RepoOptions = {}) {
  const { q, now } = repoBase(db, opts)
  return {
    has(origin: string, entity: TombstoneEntity, originId: string): boolean {
      return (
        q('SELECT 1 FROM import_tombstones WHERE origin = ? AND entity = ? AND origin_id = ?').get(
          origin,
          entity,
          originId,
        ) !== undefined
      )
    },
    /** Set of `origin_id`s that are tombstoned (preloaded by the importer). */
    ids(origin: string, entity: TombstoneEntity): Set<string> {
      const rows = q('SELECT origin_id FROM import_tombstones WHERE origin = ? AND entity = ?').all(
        origin,
        entity,
      ) as { origin_id: string }[]
      return new Set(rows.map((r) => r.origin_id))
    },
    add(origin: string, entity: TombstoneEntity, originId: string, at: number = now()): boolean {
      return (
        q('INSERT OR IGNORE INTO import_tombstones VALUES (?, ?, ?, ?)').run(
          origin,
          entity,
          originId,
          at,
        ).changes > 0
      )
    },
    remove(origin: string, entity: TombstoneEntity, originId: string): boolean {
      return (
        q('DELETE FROM import_tombstones WHERE origin = ? AND entity = ? AND origin_id = ?').run(
          origin,
          entity,
          originId,
        ).changes > 0
      )
    },
    count(origin: string, entity?: TombstoneEntity): number {
      const row = (
        entity
          ? q('SELECT count(*) AS n FROM import_tombstones WHERE origin = ? AND entity = ?').get(
              origin,
              entity,
            )
          : q('SELECT count(*) AS n FROM import_tombstones WHERE origin = ?').get(origin)
      ) as { n: number }
      return row.n
    },
    /** Importer's `ignoreTombstones` option: forgets everything for an origin. */
    clear(origin: string): number {
      return q('DELETE FROM import_tombstones WHERE origin = ?').run(origin).changes
    },
  }
}

export type TombstonesRepo = ReturnType<typeof createTombstonesRepo>
