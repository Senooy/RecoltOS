/**
 * `tags` + `item_tags` repo. Normalized names (trim, NFC, lowercase,
 * spaces → `-`, leading `#` removed); `x`, `instagram`, `cosmos` and `bookmark` are reserved for
 * virtual source chips (`AppError('tag_reserved')`). The 0001 triggers reindex the FTS
 * on each link added / removed and on renaming.
 */
import type Database from 'better-sqlite3'
import { AppError } from '../../../shared/errors'
import { newUuid } from '../../../shared/ids'
import { idList, repoBase, type RepoOptions } from './util'
import { mt } from '../../i18n'

export const RESERVED_TAG_NAMES = ['x', 'instagram', 'cosmos', 'bookmark'] as const
export const TAG_NAME_MAX = 64

export type TagLinkSource = 'user' | 'ai' | 'import'

export interface TagRow {
  id: number
  uuid: string
  name: string
  color: string | null
  created_at: number
}

export interface TagWithCount extends TagRow {
  count: number
}

/** Normalizes a tag name; throws `validation` if empty or too long. */
export function normalizeTagName(raw: string): string {
  const name = raw
    .normalize('NFC')
    .trim()
    .replace(/^#+/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
  if (!name) throw new AppError('validation', mt().errors.tagEmpty)
  if ([...name].length > TAG_NAME_MAX) {
    throw new AppError('validation', mt().errors.tagTooLong(TAG_NAME_MAX))
  }
  return name
}

export function isReservedTagName(name: string): boolean {
  return (RESERVED_TAG_NAMES as readonly string[]).includes(name)
}

function checkedName(raw: string, allowReserved: boolean): string {
  const name = normalizeTagName(raw)
  if (!allowReserved && isReservedTagName(name)) {
    throw new AppError('tag_reserved', mt().errors.tagReserved(name))
  }
  return name
}

export function createTagsRepo(db: Database.Database, opts: RepoOptions = {}) {
  const { q, now } = repoBase(db, opts)

  const getByName = (name: string): TagRow | undefined =>
    q('SELECT * FROM tags WHERE name = ?').get(normalizeTagName(name)) as TagRow | undefined

  const ensure = (
    raw: string,
    options: { allowReserved?: boolean; at?: number } = {},
  ): { id: number; uuid: string; name: string; created: boolean } => {
    const name = checkedName(raw, options.allowReserved ?? false)
    const r = q(
      'INSERT INTO tags (uuid, name, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING',
    ).run(newUuid(), name, options.at ?? now())
    const row = q('SELECT id, uuid, name FROM tags WHERE name = ?').get(name) as {
      id: number
      uuid: string
      name: string
    }
    return { ...row, created: r.changes > 0 }
  }

  return {
    ensure,
    getByName,
    getById(id: number): TagRow | undefined {
      return q('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined
    },
    getByUuid(uuid: string): TagRow | undefined {
      return q('SELECT * FROM tags WHERE uuid = ?').get(uuid) as TagRow | undefined
    },

    /** Adds the `names` tags to the items (creates missing tags). Returns the tag ids. */
    addToItems(
      itemIds: readonly number[],
      names: readonly string[],
      source: TagLinkSource = 'user',
      at: number = now(),
    ): number[] {
      return db.transaction(() => {
        const tagIds = [...new Set(names.map((n) => ensure(n, { at }).id))]
        const link = q(
          'INSERT OR IGNORE INTO item_tags (item_id, tag_id, source, created_at) VALUES (?, ?, ?, ?)',
        )
        for (const itemId of itemIds)
          for (const tagId of tagIds) link.run(itemId, tagId, source, at)
        return tagIds
      })()
    },

    removeFromItems(itemIds: readonly number[], tagIds: readonly number[]): number {
      return q(
        `DELETE FROM item_tags WHERE item_id IN (SELECT value FROM json_each(?))
           AND tag_id IN (SELECT value FROM json_each(?))`,
      ).run(idList(itemIds), idList(tagIds)).changes
    },

    /** Renames (FTS reindexed by `trg_tags_fts_au`); name already taken → `conflict`. */
    rename(id: number, raw: string): TagRow {
      return db.transaction(() => {
        const name = checkedName(raw, false)
        const current = q('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined
        if (!current) throw new AppError('not_found', mt().errors.tagNotFound)
        const clash = q('SELECT id FROM tags WHERE name = ? AND id <> ?').get(name, id)
        if (clash) throw new AppError('conflict', mt().errors.tagExists(name))
        q('UPDATE tags SET name = ? WHERE id = ?').run(name, id)
        return { ...current, name }
      })()
    },

    setColor(id: number, color: string | null): boolean {
      return q('UPDATE tags SET color = ? WHERE id = ?').run(color, id).changes > 0
    },

    /** Merges `sourceIds` into `targetId`: links reassigned (FTS reindexed), sources deleted. */
    merge(sourceIds: readonly number[], targetId: number): number {
      return db.transaction(() => {
        const sources = sourceIds.filter((id) => id !== targetId)
        if (!q('SELECT 1 FROM tags WHERE id = ?').get(targetId)) {
          throw new AppError('not_found', mt().errors.tagTargetNotFound)
        }
        const list = idList(sources)
        q(
          `INSERT OR IGNORE INTO item_tags (item_id, tag_id, source, created_at)
           SELECT item_id, ?, source, created_at FROM item_tags
           WHERE tag_id IN (SELECT value FROM json_each(?))`,
        ).run(targetId, list)
        return q('DELETE FROM tags WHERE id IN (SELECT value FROM json_each(?))').run(list).changes
      })()
    },

    delete(id: number): boolean {
      return q('DELETE FROM tags WHERE id = ?').run(id).changes > 0
    },

    /** Tags with the number of live items (not deleted, not hidden). */
    listWithCounts(): TagWithCount[] {
      return q(
        `SELECT t.*, count(i.id) AS count FROM tags t
         LEFT JOIN item_tags it ON it.tag_id = t.id
         LEFT JOIN items i ON i.id = it.item_id AND i.deleted_at IS NULL AND i.hidden_at IS NULL
         GROUP BY t.id ORDER BY count DESC, t.name`,
      ).all() as TagWithCount[]
    },

    namesOfItem(itemId: number): string[] {
      return (
        q(
          `SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id
           WHERE it.item_id = ? ORDER BY t.name`,
        ).all(itemId) as { name: string }[]
      ).map((r) => r.name)
    },
  }
}

export type TagsRepo = ReturnType<typeof createTagsRepo>
