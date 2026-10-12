/**
 * Repo `item_media` : 1..n médias par item, position 0 = principal.
 * API d'écriture gelée (ingestion, import). Les chemins sont relatifs à la racine.
 */
import type Database from 'better-sqlite3'
import { newUuid } from '../../../shared/ids'
import { buildSet, repoBase, type ColumnSpec, type RepoOptions } from './util'

export type MediaRole = 'original' | 'render' | 'screenshot'
export type MediaKind = 'image' | 'video'
export type MediaStatusValue = 'ok' | 'processing' | 'remote' | 'missing' | 'failed'

export interface MediaRow {
  id: number
  uuid: string
  item_id: number
  position: number
  role: MediaRole
  media_type: MediaKind
  status: MediaStatusValue
  file_rel: string | null
  mime: string | null
  width: number | null
  height: number | null
  file_size: number | null
  duration_ms: number | null
  has_audio: number | null
  is_animated: number
  playable: number
  content_hash: string | null
  thumb_rel: string | null
  large_rel: string | null
  poster_rel: string | null
  preview_rel: string | null
  display_rel: string | null
  legacy_thumb_rel: string | null
  derive_version: number
  remote_url: string | null
  remote_poster_url: string | null
  origin_id: string | null
  created_at: number
}

/** Champs modifiables d'un média (camelCase). */
export interface MediaFields {
  role: MediaRole
  mediaType: MediaKind
  status: MediaStatusValue
  fileRel: string | null
  mime: string | null
  width: number | null
  height: number | null
  fileSize: number | null
  durationMs: number | null
  hasAudio: boolean | null
  isAnimated: boolean
  playable: boolean
  contentHash: string | null
  thumbRel: string | null
  largeRel: string | null
  posterRel: string | null
  previewRel: string | null
  displayRel: string | null
  legacyThumbRel: string | null
  deriveVersion: number
  remoteUrl: string | null
  remotePosterUrl: string | null
  originId: string | null
}

export type NewMedia = Partial<MediaFields> & {
  mediaType: MediaKind
  uuid?: string
  /** Défaut : position suivante de l'item. */
  position?: number
  createdAt?: number
}

export type MediaPatch = Partial<MediaFields> & { position?: number }

const COLUMNS: Readonly<Record<keyof MediaPatch, ColumnSpec>> = {
  position: { col: 'position' },
  role: { col: 'role' },
  mediaType: { col: 'media_type' },
  status: { col: 'status' },
  fileRel: { col: 'file_rel' },
  mime: { col: 'mime' },
  width: { col: 'width' },
  height: { col: 'height' },
  fileSize: { col: 'file_size' },
  durationMs: { col: 'duration_ms' },
  hasAudio: { col: 'has_audio', kind: 'bool' },
  isAnimated: { col: 'is_animated', kind: 'bool' },
  playable: { col: 'playable', kind: 'bool' },
  contentHash: { col: 'content_hash' },
  thumbRel: { col: 'thumb_rel' },
  largeRel: { col: 'large_rel' },
  posterRel: { col: 'poster_rel' },
  previewRel: { col: 'preview_rel' },
  displayRel: { col: 'display_rel' },
  legacyThumbRel: { col: 'legacy_thumb_rel' },
  deriveVersion: { col: 'derive_version' },
  remoteUrl: { col: 'remote_url' },
  remotePosterUrl: { col: 'remote_poster_url' },
  originId: { col: 'origin_id' },
}

/** Colonnes de fichiers relatifs d'un média (purge, vérification). */
export const MEDIA_FILE_COLUMNS = [
  'file_rel',
  'thumb_rel',
  'large_rel',
  'poster_rel',
  'preview_rel',
  'display_rel',
  'legacy_thumb_rel',
] as const

export const MEDIA_INSERT_SQL = `INSERT INTO item_media (
  uuid, item_id, position, role, media_type, status, file_rel, mime, width, height, file_size,
  duration_ms, has_audio, is_animated, playable, content_hash, thumb_rel, large_rel, poster_rel,
  preview_rel, display_rel, legacy_thumb_rel, derive_version, remote_url, remote_poster_url,
  origin_id, created_at
) VALUES (
  @uuid, @item_id, @position, @role, @media_type, @status, @file_rel, @mime, @width, @height,
  @file_size, @duration_ms, @has_audio, @is_animated, @playable, @content_hash, @thumb_rel,
  @large_rel, @poster_rel, @preview_rel, @display_rel, @legacy_thumb_rel, @derive_version,
  @remote_url, @remote_poster_url, @origin_id, @created_at
)`

export function mediaParams(itemId: number, m: NewMedia, position: number, at: number) {
  const b = (v: boolean | null | undefined, d: number | null) =>
    v === undefined ? d : v === null ? null : v ? 1 : 0
  return {
    uuid: m.uuid ?? newUuid(),
    item_id: itemId,
    position,
    role: m.role ?? 'original',
    media_type: m.mediaType,
    status: m.status ?? 'ok',
    file_rel: m.fileRel ?? null,
    mime: m.mime ?? null,
    width: m.width ?? null,
    height: m.height ?? null,
    file_size: m.fileSize ?? null,
    duration_ms: m.durationMs ?? null,
    has_audio: b(m.hasAudio, null),
    is_animated: b(m.isAnimated, 0),
    playable: b(m.playable, 1),
    content_hash: m.contentHash ?? null,
    thumb_rel: m.thumbRel ?? null,
    large_rel: m.largeRel ?? null,
    poster_rel: m.posterRel ?? null,
    preview_rel: m.previewRel ?? null,
    display_rel: m.displayRel ?? null,
    legacy_thumb_rel: m.legacyThumbRel ?? null,
    derive_version: m.deriveVersion ?? 0,
    remote_url: m.remoteUrl ?? null,
    remote_poster_url: m.remotePosterUrl ?? null,
    origin_id: m.originId ?? null,
    created_at: m.createdAt ?? at,
  }
}

export function createMediaRepo(db: Database.Database, opts: RepoOptions = {}) {
  const { q, now } = repoBase(db, opts)

  const nextPosition = (itemId: number): number =>
    (
      q('SELECT coalesce(max(position), -1) + 1 AS p FROM item_media WHERE item_id = ?').get(
        itemId,
      ) as { p: number }
    ).p

  /** Recalcule `media_count` et rétablit une couverture si elle a disparu. */
  const syncItem = (itemId: number): void => {
    q(
      `UPDATE items SET
         media_count = (SELECT count(*) FROM item_media WHERE item_id = @id),
         cover_media_id = coalesce(
           (SELECT id FROM item_media WHERE id = items.cover_media_id),
           (SELECT id FROM item_media WHERE item_id = @id ORDER BY position LIMIT 1))
       WHERE id = @id`,
    ).run({ id: itemId })
  }

  const insertRaw = (itemId: number, m: NewMedia): { id: number; uuid: string } => {
    const params = mediaParams(itemId, m, m.position ?? nextPosition(itemId), now())
    const r = q(MEDIA_INSERT_SQL).run(params)
    return { id: Number(r.lastInsertRowid), uuid: params.uuid }
  }

  const repo = {
    /** Insertion brute, sans recalcul de l'item (utilisée par `items.insertWithMedia`). */
    insertRaw,

    /** Ajoute un média à un item existant (met à jour `media_count` et la couverture). */
    insert(itemId: number, m: NewMedia): { id: number; uuid: string } {
      return db.transaction(() => {
        const r = insertRaw(itemId, m)
        syncItem(itemId)
        return r
      })()
    },

    /** Idempotent par `uuid` (import : basename GatherOS) : n'écrase jamais l'existant. */
    upsertByUuid(itemId: number, m: NewMedia & { uuid: string }): { id: number; created: boolean } {
      return db.transaction(() => {
        const existing = q('SELECT id FROM item_media WHERE uuid = ?').get(m.uuid) as
          { id: number } | undefined
        if (existing) return { id: existing.id, created: false }
        const r = insertRaw(itemId, m)
        syncItem(itemId)
        return { id: r.id, created: true }
      })()
    },

    update(id: number, patch: MediaPatch): boolean {
      const set = buildSet(patch, COLUMNS)
      if (!set) return false
      return (
        q(`UPDATE item_media SET ${set.sql} WHERE id = @id`).run({ ...set.params, id }).changes > 0
      )
    },

    /** Supprime un média (le fichier est purgé par l'appelant) ; l'item reste cohérent. */
    delete(id: number): boolean {
      return db.transaction(() => {
        const row = q('SELECT item_id FROM item_media WHERE id = ?').get(id) as
          { item_id: number } | undefined
        if (!row) return false
        q('DELETE FROM item_media WHERE id = ?').run(id)
        syncItem(row.item_id)
        return true
      })()
    },

    getById(id: number): MediaRow | undefined {
      return q('SELECT * FROM item_media WHERE id = ?').get(id) as MediaRow | undefined
    },
    getByUuid(uuid: string): MediaRow | undefined {
      return q('SELECT * FROM item_media WHERE uuid = ?').get(uuid) as MediaRow | undefined
    },
    listByItem(itemId: number): MediaRow[] {
      return q('SELECT * FROM item_media WHERE item_id = ? ORDER BY position').all(
        itemId,
      ) as MediaRow[]
    },
    /** Dédoublonnage des ingestions : médias d'items vivants portant ce hash. */
    findByHash(contentHash: string): MediaRow[] {
      return q(
        `SELECT m.* FROM item_media m JOIN items i ON i.id = m.item_id
         WHERE m.content_hash = ? AND i.deleted_at IS NULL ORDER BY m.id`,
      ).all(contentHash) as MediaRow[]
    },
    listByStatus(status: MediaStatusValue, limit = 500): MediaRow[] {
      return q('SELECT * FROM item_media WHERE status = ? ORDER BY id LIMIT ?').all(
        status,
        limit,
      ) as MediaRow[]
    },
    setStatus(id: number, status: MediaStatusValue): boolean {
      return q('UPDATE item_media SET status = ? WHERE id = ?').run(status, id).changes > 0
    },
  }
  return repo
}

export type MediaRepo = ReturnType<typeof createMediaRepo>
