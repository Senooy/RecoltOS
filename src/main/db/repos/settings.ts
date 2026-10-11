/**
 * Repo `settings` : réglages propres à une bibliothèque (vue courante, dernier import, pauses de
 * jobs `jobs.paused`, compteur IA du jour…), valeurs JSON (ARCHI §3.3, §5.3).
 */
import type Database from 'better-sqlite3'
import type { z } from 'zod'
import { repoBase, type RepoOptions } from './util'

export function createSettingsRepo(db: Database.Database, opts: RepoOptions = {}) {
  const { q, now } = repoBase(db, opts)

  const getRaw = (key: string): unknown => {
    const row = q('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return row ? (JSON.parse(row.value) as unknown) : undefined
  }

  return {
    /** Valeur brute (`undefined` si absente). */
    get: getRaw,

    /** Valeur validée ; absente ou invalide → `fallback`. */
    getParsed<S extends z.ZodType>(key: string, schema: S, fallback: z.output<S>): z.output<S> {
      const raw = getRaw(key)
      if (raw === undefined) return fallback
      const r = schema.safeParse(raw)
      return r.success ? r.data : fallback
    },

    set(key: string, value: unknown, at: number = now()): void {
      if (value === undefined) throw new Error('valeur de réglage indéfinie')
      q(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(key, JSON.stringify(value), at)
    },

    delete(key: string): boolean {
      return q('DELETE FROM settings WHERE key = ?').run(key).changes > 0
    },

    keys(prefix = ''): string[] {
      return (
        q('SELECT key FROM settings WHERE substr(key, 1, length(?)) = ? ORDER BY key').all(
          prefix,
          prefix,
        ) as { key: string }[]
      ).map((r) => r.key)
    },
  }
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>
