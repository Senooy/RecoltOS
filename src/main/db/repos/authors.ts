/**
 * `authors` repo: shared avatar cache. A sync or the extension reporting a new `avatar_url`
 * updates ONE row; all of the author's cards benefit.
 * `handle` without `@`, unique per platform (case-insensitive).
 */
import type Database from 'better-sqlite3'
import { AppError } from '../../../shared/errors'
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

/** Removes leading `@` and spaces. */
export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').trim()
}

export function createAuthorsRepo(db: Database.Database, opts: RepoOptions = {}) {
  const { q, now } = repoBase(db, opts)
  return {
    /**
     * Creates or completes an author. A new, different `avatar_url` resets the status to `none`
     * (new download) unless the current avatar is valid (`ok`, refreshed later).
     */
    upsert(a: AuthorInput, at: number = now()): number {
      const handle = normalizeHandle(a.handle)
      if (!handle) throw new AppError('validation', 'Identifiant d’auteur vide.')
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

    /** Result of an `avatar.fetch`: `updated_at` serves as `?v=` (protocol cache). */
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
    /** Authors to (re)download: known URL and status `none` or `expired`. */
    needingAvatar(limit = 100): AuthorRow[] {
      return q(
        `SELECT * FROM authors WHERE avatar_url IS NOT NULL
           AND avatar_status IN ('none','expired') ORDER BY id LIMIT ?`,
      ).all(limit) as AuthorRow[]
    },
  }
}

export type AuthorsRepo = ReturnType<typeof createAuthorsRepo>
