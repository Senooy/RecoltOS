/**
 * Repo `authors` : cache d'avatars partagé (ARCHI §4.3). Une sync ou l'extension qui rapporte une
 * nouvelle `avatar_url` met à jour UNE ligne ; toutes les cartes de l'auteur en profitent.
 * `handle` sans `@`, unique par plateforme (insensible à la casse).
 */
import type Database from 'better-sqlite3'
import { repoBase, type RepoOptions } from './util'

export type AuthorPlatform = 'x' | 'instagram' | 'cosmos' | 'web'
export type AvatarStatus = 'none' | 'ok' | 'expired' | 'failed'

export interface AuthorRow {
  id: number
  platform: AuthorPlatform
  handle: string
  name: string | null
  avatar_url: string | null
  avatar_rel: string | null
  avatar_status: AvatarStatus
  sample_external_id: string | null
  updated_at: number
}

export interface AuthorInput {
  platform: AuthorPlatform
  handle: string
  name?: string | null
  avatarUrl?: string | null
  sampleExternalId?: string | null
}

/** Retire les `@` initiaux et les espaces. */
export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').trim()
}

export function createAuthorsRepo(db: Database.Database, opts: RepoOptions = {}) {
  const { q, now } = repoBase(db, opts)
  return {
    /**
     * Crée ou complète un auteur. Une nouvelle `avatar_url` différente remet le statut à `none`
     * (nouveau téléchargement) sauf si l'avatar actuel est valide (`ok`, rafraîchi plus tard).
     */
    upsert(a: AuthorInput, at: number = now()): number {
      const handle = normalizeHandle(a.handle)
      if (!handle) throw new Error('handle vide')
      const row = q(
        `INSERT INTO authors (platform, handle, name, avatar_url, sample_external_id, updated_at)
         VALUES (@platform, @handle, @name, @avatar_url, @sample, @at)
         ON CONFLICT (platform, handle) DO UPDATE SET
           name = coalesce(excluded.name, authors.name),
           avatar_status = CASE
             WHEN excluded.avatar_url IS NOT NULL AND excluded.avatar_url IS NOT authors.avatar_url
                  AND authors.avatar_status <> 'ok' THEN 'none'
             ELSE authors.avatar_status END,
           avatar_url = coalesce(excluded.avatar_url, authors.avatar_url),
           sample_external_id = coalesce(excluded.sample_external_id, authors.sample_external_id),
           updated_at = excluded.updated_at
         RETURNING id`,
      ).get({
        platform: a.platform,
        handle,
        name: a.name ?? null,
        avatar_url: a.avatarUrl ?? null,
        sample: a.sampleExternalId ?? null,
        at,
      }) as { id: number }
      return row.id
    },

    /** Résultat d'un `avatar.fetch` : `updated_at` sert de `?v=` (cache du protocole). */
    setAvatar(id: number, status: AvatarStatus, rel: string | null, at: number = now()): boolean {
      return (
        q(
          `UPDATE authors SET avatar_status = ?, avatar_rel = coalesce(?, avatar_rel),
             updated_at = ? WHERE id = ?`,
        ).run(status, rel, at, id).changes > 0
      )
    },

    getById(id: number): AuthorRow | undefined {
      return q('SELECT * FROM authors WHERE id = ?').get(id) as AuthorRow | undefined
    },
    getByHandle(platform: AuthorPlatform, handle: string): AuthorRow | undefined {
      return q('SELECT * FROM authors WHERE platform = ? AND handle = ?').get(
        platform,
        normalizeHandle(handle),
      ) as AuthorRow | undefined
    },
    /** Auteurs à (re)télécharger : URL connue et statut `none` ou `expired`. */
    needingAvatar(limit = 100): AuthorRow[] {
      return q(
        `SELECT * FROM authors WHERE avatar_url IS NOT NULL
           AND avatar_status IN ('none','expired') ORDER BY id LIMIT ?`,
      ).all(limit) as AuthorRow[]
    },
  }
}

export type AuthorsRepo = ReturnType<typeof createAuthorsRepo>
