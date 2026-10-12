/**
 * Execution of `search.query`: bm25-weighted FTS5 (title 8, notes 3,
 * post_text 4, ocr 2, ai 2, tags 6, url 0,5) + filters (types, sources, tags, period, collection),
 * hidden items and trash excluded. A bare word equal to a source puts the items of that source at
 * the top. Color: `PaletteIndex` + ΔE2000 (`color/color-search.ts`), one or more
 * colors (AND), adjustable tolerance; items without a palette are excluded and counted. Without text,
 * results of a color filter are sorted by proximity.
 */
import type Database from 'better-sqlite3'
import { getPaletteIndex } from '../color/palette-index'
import { queryFromHex, searchColors } from '../color/color-search'
import { AppError } from '../../shared/errors'
import type { ItemFilters } from '../../shared/ipc/items'
import { cardRowsByIds, filterWhere, type CardRow } from '../db/queries/list'
import { toFtsQuery, type ParsedQuery } from '../../shared/search-query'
import { mt } from '../i18n'

/** Internal cap on examined identifiers (beyond it, the list is truncated). */
export const SEARCH_CAP = 5000

const LIVE = 'i.deleted_at IS NULL AND i.hidden_at IS NULL'
const BM25 = 'bm25(items_fts, 8.0, 3.0, 4.0, 2.0, 2.0, 6.0, 0.5)'

export interface SearchResult {
  rows: CardRow[]
  total: number
  /** Items discarded by the color filter for lack of a palette. */
  noPalette: number
  parsed: ParsedQuery
}

const union = <T>(a: readonly T[] | undefined, b: readonly T[]): T[] => [
  ...new Set([...(a ?? []), ...b]),
]

function isFtsError(err: unknown): boolean {
  return err instanceof Error && /fts5|syntax error|unterminated|no such column/i.test(err.message)
}

export function runSearch(
  db: Database.Database,
  input: { q: string; filters?: ItemFilters | undefined; limit: number },
): SearchResult {
  const parsed = toFtsQuery(input.q)
  const f: ItemFilters = {
    ...(input.filters ?? {}),
    sources: union(input.filters?.sources, parsed.sources),
    kinds: union(input.filters?.kinds, parsed.kinds),
  }
  const colors = [
    ...new Set(
      [...(input.filters?.colors ?? []), input.filters?.color ?? parsed.color].filter(
        (c): c is string => typeof c === 'string',
      ),
    ),
  ]
  const tolerance = input.filters?.colorTolerance
  delete f.color
  delete f.colors
  delete f.colorTolerance
  const params: Record<string, unknown> = {}
  const where = [LIVE, ...filterWhere(f, params)].join(' AND ')

  let ids: number[]
  try {
    if (parsed.match) {
      params.q = parsed.match
      ids = (
        db
          .prepare(
            `SELECT i.id AS id FROM items_fts JOIN items i ON i.id = items_fts.rowid
             WHERE items_fts MATCH @q AND ${where} ORDER BY ${BM25} LIMIT ${SEARCH_CAP}`,
          )
          .all(params) as { id: number }[]
      ).map((r) => r.id)
    } else {
      ids = (
        db
          .prepare(
            `SELECT i.id AS id FROM items i WHERE ${where}
             ORDER BY i.created_at DESC, i.id DESC LIMIT ${SEARCH_CAP}`,
          )
          .all(params) as { id: number }[]
      ).map((r) => r.id)
    }
  } catch (err) {
    if (isFtsError(err)) throw new AppError('validation', mt().errors.searchInvalid)
    throw err
  }

  // "instagram": Instagram items first, then full-text matches.
  if (parsed.sourceWords.length > 0 && parsed.match) {
    const p2: Record<string, unknown> = { ...params, sw: JSON.stringify(parsed.sourceWords) }
    delete p2.q
    const head = (
      db
        .prepare(
          `SELECT i.id AS id FROM items i
           WHERE ${where} AND i.source IN (SELECT value FROM json_each(@sw))
           ORDER BY i.created_at DESC, i.id DESC LIMIT ${SEARCH_CAP}`,
        )
        .all(p2) as { id: number }[]
    ).map((r) => r.id)
    const seen = new Set(head)
    ids = [...head, ...ids.filter((id) => !seen.has(id))].slice(0, SEARCH_CAP)
  }

  let noPalette = 0
  if (colors.length > 0) {
    const r = searchColors(
      getPaletteIndex(db),
      colors.map((c) => queryFromHex(c, tolerance)),
      ids,
    )
    noPalette = r.noPalette
    if (parsed.match) {
      const keep = new Set(r.matches.map((m) => m.id))
      ids = ids.filter((id) => keep.has(id))
    } else {
      ids = r.matches.map((m) => m.id)
    }
  }

  return {
    rows: cardRowsByIds(db, ids.slice(0, input.limit)),
    total: ids.length,
    noPalette,
    parsed,
  }
}

/** Suggestions (⌘K palette, search field): tags and collections whose name matches. */
export function suggest(
  db: Database.Database,
  q: string,
  limit = 8,
): {
  tags: { uuid: string; name: string; color: string | null; count: number }[]
  collections: { uuid: string; name: string }[]
} {
  const text = q.trim().replace(/^[#@]/, '').toLowerCase()
  if (!text) return { tags: [], collections: [] }
  const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const tags = db
    .prepare(
      `SELECT t.uuid, t.name, t.color,
              (SELECT count(*) FROM item_tags it JOIN items i ON i.id = it.item_id
               WHERE it.tag_id = t.id AND i.deleted_at IS NULL AND i.hidden_at IS NULL) AS count
       FROM tags t WHERE lower(t.name) LIKE ? ESCAPE '\\'
       ORDER BY (lower(t.name) LIKE ? ESCAPE '\\') DESC, count DESC, t.name LIMIT ?`,
    )
    .all(like, `${text}%`, limit) as {
    uuid: string
    name: string
    color: string | null
    count: number
  }[]
  const collections = db
    .prepare(
      `SELECT uuid, name FROM collections WHERE lower(name) LIKE ? ESCAPE '\\'
       ORDER BY (lower(name) LIKE ? ESCAPE '\\') DESC, coalesce(viewed_at, 0) DESC, name LIMIT ?`,
    )
    .all(like, `${text}%`, limit) as { uuid: string; name: string }[]
  return { tags, collections }
}
