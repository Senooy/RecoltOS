/**
 * Exécution de `search.query` (ARCHI §4.5, DESIGN §3.5) : FTS5 pondérée bm25 (title 8, notes 3,
 * post_text 4, ocr 2, ai 2, tags 6, url 0,5) + filtres (types, sources, tags, période, collection),
 * masqués et corbeille exclus. Un mot nu égal à une source met les éléments de cette source en
 * tête. Couleur : filtre provisoire ΔE76 sur les 3 premières couleurs de la palette, en attendant
 * le `PaletteIndex` de WP-31 (les éléments sans palette sont exclus et comptés).
 */
import type Database from 'better-sqlite3'
import { hexToRgb, rgbToLab, type Lab } from '../../shared/color'
import { AppError } from '../../shared/errors'
import type { ItemFilters } from '../../shared/ipc/items'
import { cardRowsByIds, filterWhere, type CardRow } from '../db/queries/list'
import { toFtsQuery, type ParsedQuery } from '../../shared/search-query'

/** Plafond interne des identifiants examinés (au-delà, la liste est tronquée). */
export const SEARCH_CAP = 5000
/** Distance ΔE76 maximale pour le filtre de couleur provisoire. */
export const COLOR_MAX_DE = 22

const LIVE = 'i.deleted_at IS NULL AND i.hidden_at IS NULL'
const BM25 = 'bm25(items_fts, 8.0, 3.0, 4.0, 2.0, 2.0, 6.0, 0.5)'

export interface SearchResult {
  rows: CardRow[]
  total: number
  /** Éléments écartés par le filtre de couleur faute de palette. */
  noPalette: number
  parsed: ParsedQuery
}

const union = <T>(a: readonly T[] | undefined, b: readonly T[]): T[] => [
  ...new Set([...(a ?? []), ...b]),
]

function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

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
  const color = input.filters?.color ?? parsed.color
  delete f.color
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
    if (isFtsError(err)) throw new AppError('validation', 'Recherche invalide.')
    throw err
  }

  // « instagram » : les éléments Instagram d'abord, puis les correspondances plein texte.
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
  if (color) {
    const target = rgbToLab(hexToRgb(color))
    const palettes = new Map(
      (
        db
          .prepare('SELECT id, palette FROM items WHERE id IN (SELECT value FROM json_each(?))')
          .all(JSON.stringify(ids)) as { id: number; palette: string | null }[]
      ).map((r) => [r.id, r.palette]),
    )
    ids = ids.filter((id) => {
      const raw = palettes.get(id)
      let hexes: unknown = null
      try {
        hexes = raw ? JSON.parse(raw) : null
      } catch {
        hexes = null
      }
      if (!Array.isArray(hexes) || hexes.length === 0) {
        noPalette++
        return false
      }
      return hexes
        .slice(0, 3)
        .some(
          (h) =>
            typeof h === 'string' &&
            /^#[0-9a-f]{6}$/i.test(h) &&
            deltaE(rgbToLab(hexToRgb(h)), target) <= COLOR_MAX_DE,
        )
    })
  }

  return {
    rows: cardRowsByIds(db, ids.slice(0, input.limit)),
    total: ids.length,
    noPalette,
    parsed,
  }
}

/** Suggestions (palette ⌘K, champ de recherche) : tags et collections dont le nom correspond. */
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
