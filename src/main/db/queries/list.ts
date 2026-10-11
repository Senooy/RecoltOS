/**
 * Lectures de liste (ARCHI §7, §8 ; PLAN §1.22) : portées `library` (onglets) et `collection`
 * (membres directs, masqués compris), tris keyset sans `OFFSET` (sauf `random`, par graine),
 * filtres. Les écritures passent par les repos (WP-02).
 */
import type Database from 'better-sqlite3'
import { AppError } from '../../../shared/errors'
import type { ItemsListInput } from '../../../shared/ipc/items'
import type { ItemFilters } from '../../../shared/ipc/items'
import type { LibraryTab, SortMode } from '../../../shared/enums'

/** Colonnes d'une carte : item + média de couverture + auteur (jointures sur clé primaire). */
export const CARD_SELECT = `
  i.id, i.uuid, i.kind, i.source, i.source_url, i.title, i.ai_title, i.notes, i.palette, i.post_meta,
  i.created_at, i.view_count, i.viewed_at, i.deleted_at, i.hidden_at, i.color_key, i.name_key,
  (SELECT count(*) FROM item_media x WHERE x.item_id = i.id AND x.status <> 'missing') AS live_media,
  m.media_type AS m_media_type, m.status AS m_status, m.file_rel AS m_file_rel, m.mime AS m_mime,
  m.width AS m_width, m.height AS m_height, m.duration_ms AS m_duration_ms,
  m.is_animated AS m_is_animated, m.thumb_rel AS m_thumb_rel, m.large_rel AS m_large_rel,
  m.poster_rel AS m_poster_rel, m.preview_rel AS m_preview_rel, m.display_rel AS m_display_rel,
  m.legacy_thumb_rel AS m_legacy_thumb_rel, m.derive_version AS m_derive_version,
  a.name AS a_name, a.handle AS a_handle, a.avatar_rel AS a_avatar_rel,
  a.avatar_status AS a_avatar_status, a.updated_at AS a_updated_at`

export const CARD_FROM = `items i
  LEFT JOIN item_media m ON m.id = i.cover_media_id
  LEFT JOIN authors a ON a.id = i.author_id`

export interface CardRow {
  id: number
  uuid: string
  kind: string
  source: string
  source_url: string | null
  title: string | null
  ai_title: string | null
  notes: string | null
  palette: string | null
  post_meta: string | null
  created_at: number
  view_count: number
  viewed_at: number | null
  deleted_at: number | null
  hidden_at: number | null
  color_key: number
  name_key: string
  live_media: number
  m_media_type: 'image' | 'video' | null
  m_status: 'ok' | 'processing' | 'remote' | 'missing' | 'failed' | null
  m_file_rel: string | null
  m_mime: string | null
  m_width: number | null
  m_height: number | null
  m_duration_ms: number | null
  m_is_animated: number | null
  m_thumb_rel: string | null
  m_large_rel: string | null
  m_poster_rel: string | null
  m_preview_rel: string | null
  m_display_rel: string | null
  m_legacy_thumb_rel: string | null
  m_derive_version: number | null
  a_name: string | null
  a_handle: string | null
  a_avatar_rel: string | null
  a_avatar_status: string | null
  a_updated_at: number | null
  /** Clé de tri exposée pour le curseur. */
  sort_key?: number | string
  added_at?: number
}

interface SortSpec {
  /** Expression SQL sans NULL. */
  key: string
  dir: 'ASC' | 'DESC'
}

/** Tri d'une portée (ARCHI §7) ; la corbeille trie « récents » par date de suppression. */
export function sortSpec(
  sort: SortMode,
  _scope: 'library' | 'collection',
  tab: LibraryTab,
): SortSpec | null {
  switch (sort) {
    // En collection aussi, « Plus récents » suit la date de l'élément (fidélité `c7j4tx` : Dev
    // commence par « Colorful Usage Monitor » puis « Social Media Profile », dans l'ordre des dates
    // d'ajout à la bibliothèque et non d'entrée dans la collection). Les couvertures, elles, restent
    // sur `collection_items.added_at` (ERRATA §C).
    case 'recent':
      return { key: tab === 'trash' ? 'i.deleted_at' : 'i.created_at', dir: 'DESC' }
    case 'oldest':
      return { key: 'i.created_at', dir: 'ASC' }
    case 'name':
      return { key: 'i.name_key', dir: 'ASC' }
    case 'color':
      return { key: 'i.color_key', dir: 'ASC' }
    case 'viewed':
      return { key: 'coalesce(i.viewed_at, -1)', dir: 'DESC' }
    case 'mostViewed':
      return { key: 'i.view_count', dir: 'DESC' }
    case 'random':
      return null
  }
}

export function encodeCursor(v: unknown[]): string {
  return Buffer.from(JSON.stringify(v)).toString('base64url')
}

export function decodeCursor(c: string): unknown[] {
  try {
    const v: unknown = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'))
    if (Array.isArray(v)) return v
  } catch {
    // ci-dessous
  }
  throw new AppError('validation', 'curseur invalide')
}

const LIVE = 'i.deleted_at IS NULL AND i.hidden_at IS NULL'
const IN_ANY = 'EXISTS (SELECT 1 FROM collection_items ci2 WHERE ci2.item_id = i.id)'

export function tabWhere(tab: LibraryTab): string {
  switch (tab) {
    case 'all':
      return LIVE
    case 'saved':
      return `${LIVE} AND ${IN_ANY}`
    case 'unsorted':
      return `${LIVE} AND NOT ${IN_ANY}`
    case 'trash':
      return 'i.deleted_at IS NOT NULL'
    case 'hidden':
      return 'i.hidden_at IS NOT NULL AND i.deleted_at IS NULL'
  }
}

export function filterWhere(f: ItemFilters | undefined, params: Record<string, unknown>): string[] {
  if (!f) return []
  const out: string[] = []
  if (f.kinds && f.kinds.length > 0) {
    params.f_kinds = JSON.stringify(f.kinds)
    out.push('i.kind IN (SELECT value FROM json_each(@f_kinds))')
  }
  if (f.sources && f.sources.length > 0) {
    params.f_sources = JSON.stringify(f.sources)
    out.push('i.source IN (SELECT value FROM json_each(@f_sources))')
  }
  if (f.tagUuids && f.tagUuids.length > 0) {
    params.f_tags = JSON.stringify(f.tagUuids)
    out.push(
      `EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id
               WHERE it.item_id = i.id AND t.uuid IN (SELECT value FROM json_each(@f_tags)))`,
    )
  }
  if (f.period?.from != null) {
    params.f_from = f.period.from
    out.push('i.created_at >= @f_from')
  }
  if (f.period?.to != null) {
    params.f_to = f.period.to
    out.push('i.created_at <= @f_to')
  }
  if (f.collectionUuid) {
    params.f_col = f.collectionUuid
    out.push(
      `EXISTS (SELECT 1 FROM collection_items c3 JOIN collections cc ON cc.id = c3.collection_id
               WHERE c3.item_id = i.id AND cc.uuid = @f_col)`,
    )
  }
  return out
}

export interface ListResult {
  rows: CardRow[]
  nextCursor: string | null
  total: number
}

type ParsedList = {
  scope: 'library' | 'collection'
  tab?: LibraryTab
  collectionUuid?: string
  sort: SortMode
  seed?: number | undefined
  cursor: string | null
  limit: number
  filters?: ItemFilters | undefined
}

export function listItems(db: Database.Database, input: ParsedList | ItemsListInput): ListResult {
  const inp = input as ParsedList
  const scope = inp.scope
  const tab: LibraryTab = scope === 'library' ? (inp.tab ?? 'all') : 'all'
  const sort: SortMode = inp.sort ?? 'recent'
  const limit = inp.limit ?? 120
  const params: Record<string, unknown> = {}
  const where: string[] = []
  let from = CARD_FROM
  if (scope === 'collection') {
    const col = db.prepare('SELECT id FROM collections WHERE uuid = ?').get(inp.collectionUuid) as
      { id: number } | undefined
    if (!col) throw new AppError('not_found', 'Collection introuvable.')
    params.cid = col.id
    from = `${CARD_FROM} JOIN collection_items ci ON ci.item_id = i.id AND ci.collection_id = @cid`
    where.push('i.deleted_at IS NULL')
  } else {
    where.push(tabWhere(tab))
  }
  where.push(...filterWhere(inp.filters, params))
  const baseWhere = where.join(' AND ')
  const total = (
    db.prepare(`SELECT count(*) AS n FROM ${from} WHERE ${baseWhere}`).get(params) as { n: number }
  ).n

  const spec = sortSpec(sort, scope, tab)
  if (!spec) {
    // Aléatoire stable par graine (bouton « Mélanger ») ; curseur = décalage.
    params.seed = inp.seed ?? 0
    const offset = inp.cursor ? Number(decodeCursor(inp.cursor)[0]) || 0 : 0
    params.lim = limit
    params.off = offset
    const rows = db
      .prepare(
        `SELECT ${CARD_SELECT} FROM ${from} WHERE ${baseWhere}
         ORDER BY ((i.id * 2654435761 + @seed) % 4294967296), i.id LIMIT @lim OFFSET @off`,
      )
      .all(params) as CardRow[]
    const next = offset + rows.length
    return { rows, nextCursor: next < total ? encodeCursor([next]) : null, total }
  }
  const cmp = spec.dir === 'DESC' ? '<' : '>'
  let keyset = ''
  if (inp.cursor) {
    const [v, id] = decodeCursor(inp.cursor)
    if ((typeof v !== 'number' && typeof v !== 'string') || typeof id !== 'number') {
      throw new AppError('validation', 'curseur invalide')
    }
    params.cv = v
    params.cid_ = id
    keyset = ` AND (${spec.key}, i.id) ${cmp} (@cv, @cid_)`
  }
  params.lim = limit
  const rows = db
    .prepare(
      `SELECT ${CARD_SELECT}, ${spec.key} AS sort_key FROM ${from}
       WHERE ${baseWhere}${keyset}
       ORDER BY ${spec.key} ${spec.dir}, i.id ${spec.dir} LIMIT @lim`,
    )
    .all(params) as CardRow[]
  const last = rows[rows.length - 1]
  const nextCursor =
    rows.length === limit && last ? encodeCursor([last.sort_key ?? 0, last.id]) : null
  return { rows, nextCursor, total }
}

/** Carte(s) par uuid (ordre de la liste fournie). */
export function cardRowsByUuid(db: Database.Database, uuids: readonly string[]): CardRow[] {
  if (uuids.length === 0) return []
  const rows = db
    .prepare(
      `SELECT ${CARD_SELECT} FROM ${CARD_FROM} WHERE i.uuid IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(uuids)) as CardRow[]
  const by = new Map(rows.map((r) => [r.uuid, r]))
  return uuids.map((u) => by.get(u)).filter((r): r is CardRow => r !== undefined)
}

/** Carte(s) par id interne (ordre de la liste fournie). */
export function cardRowsByIds(db: Database.Database, ids: readonly number[]): CardRow[] {
  if (ids.length === 0) return []
  const rows = db
    .prepare(
      `SELECT ${CARD_SELECT} FROM ${CARD_FROM} WHERE i.id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(ids)) as CardRow[]
  const by = new Map(rows.map((r) => [r.id, r]))
  return ids.map((id) => by.get(id)).filter((r): r is CardRow => r !== undefined)
}

/** « Récemment vus » (palette ⌘K) : `ix_items_viewed`, masqués exclus. */
export function recentlyViewed(db: Database.Database, limit: number): CardRow[] {
  return db
    .prepare(
      `SELECT ${CARD_SELECT} FROM ${CARD_FROM}
       WHERE i.viewed_at IS NOT NULL AND i.deleted_at IS NULL AND i.hidden_at IS NULL
       ORDER BY i.viewed_at DESC LIMIT ?`,
    )
    .all(limit) as CardRow[]
}
