/**
 * Repo de recherche (ARCHI §4.5) : exécution d'une requête FTS5 déjà construite
 * (`search/fts-query.ts`, hors de ce lot), maintenance de l'index et historique.
 * Pondération bm25 : title 8, notes 3, post_text 4, ocr 2, ai 2, tags 6, url 0,5.
 */
import type Database from 'better-sqlite3'
import { AppError } from '../../../shared/errors'
import { repoBase, type RepoOptions } from './util'

export const FTS_LIMIT = 300

export interface FtsHit {
  id: number
  score: number
}

const FTS_COLUMNS = 'title, notes, post_text, ocr_text, ai_text, tags, url'

function isFtsSyntaxError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /fts5|syntax error|unterminated string|no such column/i.test(err.message)
  )
}

export function createSearchRepo(db: Database.Database, opts: RepoOptions = {}) {
  const { q, now } = repoBase(db, opts)
  return {
    /**
     * Items vivants (non supprimés, non masqués) qui correspondent à `match`, triés par bm25.
     * `sources` (chips `#x #instagram #cosmos`) restreint `items.source`. Syntaxe FTS invalide →
     * `AppError('validation')`.
     */
    match(
      match: string,
      options: { sources?: readonly string[] | null; limit?: number } = {},
    ): FtsHit[] {
      try {
        return q(
          `SELECT i.id AS id, bm25(items_fts, 8.0, 3.0, 4.0, 2.0, 2.0, 6.0, 0.5) AS score
           FROM items_fts JOIN items i ON i.id = items_fts.rowid
           WHERE items_fts MATCH @q AND i.deleted_at IS NULL AND i.hidden_at IS NULL
             AND (@sources IS NULL OR i.source IN (SELECT value FROM json_each(@sources)))
           ORDER BY score LIMIT @limit`,
        ).all({
          q: match,
          sources: options.sources?.length ? JSON.stringify(options.sources) : null,
          limit: options.limit ?? FTS_LIMIT,
        }) as FtsHit[]
      } catch (err) {
        if (isFtsSyntaxError(err)) throw new AppError('validation', 'Recherche invalide.')
        throw err
      }
    },

    /** Reconstruit l'index depuis la vue source (« Reconstruire l'index », restauration). */
    rebuild(): number {
      return db.transaction(() => {
        q('DELETE FROM items_fts').run()
        return q(
          `INSERT INTO items_fts (rowid, ${FTS_COLUMNS})
           SELECT item_id, ${FTS_COLUMNS} FROM items_fts_src`,
        ).run().changes
      })()
    },

    /** Après un import. */
    optimize(): void {
      q("INSERT INTO items_fts (items_fts) VALUES ('optimize')").run()
    },

    /** Nombre de lignes de l'index (contrôle d'absence de ligne fantôme). */
    indexedCount(): number {
      return (q('SELECT count(*) AS n FROM items_fts').get() as { n: number }).n
    },

    addHistory(query: string, at: number = now()): void {
      const text = query.trim()
      if (!text) return
      q(
        `INSERT INTO search_history (query, used_at, uses) VALUES (?, ?, 1)
         ON CONFLICT (query) DO UPDATE SET used_at = excluded.used_at, uses = uses + 1`,
      ).run(text, at)
    },
    listHistory(limit = 10): { query: string; usedAt: number; uses: number }[] {
      return q(
        'SELECT query, used_at AS usedAt, uses FROM search_history ORDER BY used_at DESC LIMIT ?',
      ).all(limit) as { query: string; usedAt: number; uses: number }[]
    },
    clearHistory(): number {
      return q('DELETE FROM search_history').run().changes
    },
  }
}

export type SearchRepo = ReturnType<typeof createSearchRepo>
