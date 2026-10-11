/**
 * Pierres tombales d'import (ARCHI §4.3, §6.8) : ce que l'utilisateur a retiré d'un import n'est
 * jamais recréé par un ré-import. Les triggers de 0001 posent celles des suppressions directes ;
 * `collections.delete` pose explicitement celles des descendants.
 */
import type Database from 'better-sqlite3'
import { repoBase, type RepoOptions } from './util'

export type TombstoneEntity = 'item' | 'collection' | 'membership'

/** Clé d'une appartenance : `<collectionOriginId>:<itemOriginId>`. */
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
    /** Ensemble des `origin_id` en pierre tombale (préchargé par l'importeur). */
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
    /** Option `ignoreTombstones` de l'importeur : oublie tout pour une origine. */
    clear(origin: string): number {
      return q('DELETE FROM import_tombstones WHERE origin = ?').run(origin).changes
    },
  }
}

export type TombstonesRepo = ReturnType<typeof createTombstonesRepo>
