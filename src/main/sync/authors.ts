/**
 * Auteurs des publications synchronisées : cache d'avatars par
 * `(plateforme, handle)` (une URL fraîche remet le téléchargement en file), `sample_external_id`
 * (pour `item.refresh`), liste `wantedAuthors` envoyée à l'extension (auteurs sans avatar valide).
 */
import { MAX_WANTED_AUTHORS, type BridgePlatform } from '../../shared/bridge/constants'
import { JOB_PRIORITY } from '../../shared/jobs'
import type { LibraryContext } from '../library/library-context'
import type { NormalizedPost } from './parsers'

/** Upsert de tous les auteurs d'une publication ; rend l'id de l'auteur principal. */
export function upsertPostAuthors(
  lib: LibraryContext,
  post: NormalizedPost,
  at: number,
): number | null {
  let mainId: number | null = null
  const main = post.author?.handle?.toLowerCase() ?? null
  for (const a of post.authors) {
    if (!a.handle) continue
    const id = lib.repos.authors.upsert(
      {
        platform: post.platform,
        handle: a.handle,
        name: a.name,
        avatarUrl: a.avatarUrl,
        sampleExternalId: a.handle.toLowerCase() === main ? post.externalId : null,
      },
      at,
    )
    if (a.handle.toLowerCase() === main) mainId = id
  }
  if (mainId === null && post.author?.handle) {
    mainId = lib.repos.authors.upsert(
      {
        platform: post.platform,
        handle: post.author.handle,
        name: post.author.name,
        avatarUrl: post.author.avatarUrl,
        sampleExternalId: post.externalId,
      },
      at,
    )
  }
  return mainId
}

/** Auteurs sans avatar valide (rafraîchissement gratuit par `author.seen`), 500 au plus. */
export function wantedAuthors(lib: LibraryContext): { platform: BridgePlatform; handle: string }[] {
  return lib.db
    .prepare(
      `SELECT platform, handle FROM authors
         WHERE platform IN ('x','instagram','cosmos') AND avatar_status IN ('none','expired','failed')
         ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(MAX_WANTED_AUTHORS) as { platform: BridgePlatform; handle: string }[]
}

/** `author.seen` : nouvelle URL d'avatar → téléchargement (sans appel d'API). */
export function authorSeen(
  lib: LibraryContext,
  a: { platform: BridgePlatform; handle: string; name?: string | null; avatarUrl?: string | null },
  at: number,
): boolean {
  if (!a.avatarUrl || !/^https:\/\//.test(a.avatarUrl)) return false
  const before = lib.repos.authors.getByHandle(a.platform, a.handle)
  if (!before) return false
  const id = lib.repos.authors.upsert(
    { platform: a.platform, handle: a.handle, name: a.name ?? null, avatarUrl: a.avatarUrl },
    at,
  )
  const after = lib.repos.authors.getById(id)
  if (after && after.avatar_status !== 'ok') {
    lib.repos.jobs.enqueue({
      type: 'avatar.fetch',
      dedupeKey: `author:${id}`,
      payload: { authorId: id },
      priority: JOB_PRIORITY.SYNC,
    })
    return true
  }
  return false
}
