/**
 * Ingestion d'une page de sync : UNE transaction par page. Chaque publication
 * est classée (connue avec élément / connue sans élément / écartée / nouvelle), placée dans l'ordre
 * (`order.ts`), puis les nouvelles sont insérées : `items` (`post_meta` v1, `origin='sync'`,
 * `origin_id = source_key`), `item_media` en `remote` (téléchargés ensuite par l'app,
 * `media.download`), `authors`, `sync_items`, images citées (`remote.fetch`), avatars (`avatar.fetch`).
 * Règle d'arrêt de l'incrémental : page non vide entièrement connue ou écartée, ou 10 connues
 * consécutives. `backfill` et `deep` ne s'arrêtent jamais sur un élément connu.
 */
import { JOB_PRIORITY } from '../../shared/jobs'
import { AI_MAX_ATTEMPTS } from '../ai/errors'
import { autoJobPayload } from '../ai/service'
import type { NewMedia } from '../db/repos/media'
import { syncSourceKey, type SyncSourceValue } from '../db/repos/sync'
import { aiGate } from '../ingest/ai-gate'
import { remoteKey, remoteRelFor } from '../library/remote-index'
import type { LibraryContext } from '../library/library-context'
import type { Prefs } from '../../shared/prefs'
import { upsertPostAuthors } from './authors'
import { assignCreatedAt, type Known, type OrderCursor, type RunMode } from './order'
import type { NormalizedMedia, NormalizedPost } from './parsers'

export const KNOWN_STREAK_STOP = 10

export interface PageIngestInput {
  platform: SyncSourceValue
  mode: RunMode
  posts: readonly NormalizedPost[]
  /** Ancre d'ordre courante (modifiée ; persistée par l'appelant pour le backfill). */
  order: OrderCursor
  runStartedAt: number
  accountId?: string | null
}

export interface PageIngestResult {
  createdUuids: string[]
  stats: { parsed: number; new: number; known: number; dismissed: number }
  /** L'incrémental doit s'arrêter (tout connu, ou série de connus). */
  stopIncremental: boolean
  recovered: number
}

export interface IngestServices {
  lib: LibraryContext
  prefs: () => Prefs
  now: () => number
}

/** Classe une clé : élément vivant/corbeille, connu sans élément, écarté, nouveau. */
export function lookupKnown(
  lib: LibraryContext,
  platform: SyncSourceValue,
  externalId: string,
): Known {
  const key = syncSourceKey(platform, externalId)
  const row = lib.db
    .prepare(
      `SELECT s.item_id AS item_id, i.created_at AS created_at FROM sync_items s
       LEFT JOIN items i ON i.id = s.item_id WHERE s.source_key = ?`,
    )
    .get(key) as { item_id: number | null; created_at: number | null } | undefined
  if (row && row.item_id !== null && row.created_at !== null) {
    return { state: 'saved', createdAt: row.created_at }
  }
  if (lib.repos.sync.isDismissed(platform, externalId)) return { state: 'dismissed' }
  // Élément importé sans ligne `sync_items` (filet) : rattaché par `source + external_id`.
  const item = lib.db
    .prepare(
      'SELECT id, created_at FROM items WHERE source = ? AND external_id = ? ORDER BY created_at LIMIT 1',
    )
    .get(platform, externalId) as { id: number; created_at: number } | undefined
  if (item) {
    lib.repos.sync.upsertItem({ source: platform, externalId, itemId: item.id })
    return { state: 'saved', createdAt: item.created_at }
  }
  if (row) return { state: 'known_no_save' }
  return { state: 'new' }
}

function mediaRows(post: NormalizedPost): NewMedia[] {
  return post.media
    .filter((m) => m.url || m.hlsUrl)
    .map((m: NormalizedMedia, i) => ({
      mediaType: m.type,
      role: 'original' as const,
      status: 'remote' as const,
      remoteUrl: m.url ?? m.hlsUrl,
      remotePosterUrl: m.posterUrl,
      width: m.width,
      height: m.height,
      durationMs: m.durationMs,
      isAnimated: m.gif,
      hasAudio: m.gif ? false : null,
      position: i,
    }))
}

/** Priorité de téléchargement : Instagram d'abord (URL signées qui expirent). */
export function downloadPriority(platform: SyncSourceValue): number {
  return platform === 'instagram' ? JOB_PRIORITY.SYNC + 10 : JOB_PRIORITY.SYNC
}

export function ingestPage(s: IngestServices, input: PageIngestInput): PageIngestResult {
  const { lib } = s
  const at = s.now()
  const byKey = new Map(input.posts.map((p) => [p.sourceKey, p]))
  const created: string[] = []
  const stats = { parsed: input.posts.length, new: 0, known: 0, dismissed: 0 }
  let recovered = 0
  let streak = 0
  let maxStreak = 0

  lib.db.transaction(() => {
    const known = new Map<string, Known>()
    for (const p of input.posts) {
      const k = lookupKnown(lib, input.platform, p.externalId)
      known.set(p.sourceKey, k)
      if (k.state === 'new') {
        streak = 0
      } else {
        if (k.state === 'dismissed') stats.dismissed += 1
        else stats.known += 1
        streak += 1
        maxStreak = Math.max(maxStreak, streak)
      }
    }
    const placed = assignCreatedAt(
      input.mode,
      input.posts,
      input.order,
      (key) => known.get(key) ?? { state: 'new' },
      input.runStartedAt,
    )
    const prefs = s.prefs()
    for (const pl of placed) {
      const post = byKey.get(pl.sourceKey)
      if (!post) continue
      const authorId = upsertPostAuthors(lib, post, at)
      const aiState = aiGate({
        prefs,
        settings: lib.repos.settings,
        userAction: false,
        batchSize: placed.length,
        now: at,
      })
      const media = mediaRows(post)
      const exists = lib.db
        .prepare("SELECT 1 FROM items WHERE origin = 'sync' AND origin_id = ?")
        .get(post.sourceKey)
      if (exists) continue
      const res = lib.repos.items.insertWithMedia(
        {
          kind: post.kind,
          source: input.platform,
          externalId: post.externalId,
          sourceUrl: post.sourceUrl,
          authorId,
          postMeta: post.postMeta,
          postedAt: post.postedAt,
          aiState,
          origin: 'sync',
          originId: post.sourceKey,
          createdAt: pl.createdAt,
        },
        media,
      )
      stats.new += 1
      created.push(res.uuid)
      lib.repos.sync.upsertItem(
        {
          source: input.platform,
          externalId: post.externalId,
          itemId: res.id,
          accountId: input.accountId ?? null,
          remoteSort: post.remoteSort,
        },
        at,
      )
      if (pl.recovered) {
        recovered += 1
        lib.db
          .prepare('UPDATE sync_items SET recovered_at = ? WHERE source_key = ?')
          .run(at, post.sourceKey)
      }
      for (const mid of res.mediaIds) {
        lib.repos.jobs.enqueue(
          {
            type: 'media.download',
            itemId: res.id,
            dedupeKey: `dl:${mid}`,
            payload: { mediaId: mid },
            priority: downloadPriority(input.platform),
          },
          at,
        )
      }
      if (aiState === 'queued') {
        lib.repos.jobs.enqueue(
          {
            type: 'ai.enrich',
            itemId: res.id,
            dedupeKey: `ai:${res.id}`,
            priority: JOB_PRIORITY.SYNC,
            payload: { ...autoJobPayload(prefs.ai) },
            maxAttempts: AI_MAX_ATTEMPTS,
          },
          at,
        )
      }
      for (const m of post.postMeta.quoted?.media ?? []) {
        const url = m.remoteUrl
        if (!url || remoteRelFor(lib.root, url)) continue
        lib.repos.jobs.enqueue(
          {
            type: 'remote.fetch',
            dedupeKey: `remote:${remoteKey(url)}`,
            payload: { url, itemUuid: res.uuid },
            priority: JOB_PRIORITY.SYNC,
          },
          at,
        )
      }
    }
    // Les connues sont vues à nouveau (dernière vue, tri distant).
    for (const p of input.posts) {
      if (known.get(p.sourceKey)?.state === 'saved') {
        lib.repos.sync.upsertItem(
          { source: input.platform, externalId: p.externalId, remoteSort: p.remoteSort },
          at,
        )
      }
    }
    // Avatars à télécharger (URL fraîche).
    for (const a of lib.repos.authors.needingAvatar(50)) {
      if (a.platform !== input.platform) continue
      lib.repos.jobs.enqueue(
        {
          type: 'avatar.fetch',
          dedupeKey: `author:${a.id}`,
          payload: { authorId: a.id },
          priority: downloadPriority(input.platform),
        },
        at,
      )
    }
  })()

  const allKnown =
    input.posts.length > 0 &&
    stats.new === 0 &&
    stats.known + stats.dismissed === input.posts.length
  return {
    createdUuids: created,
    stats,
    stopIncremental: allKnown || maxStreak >= KNOWN_STREAK_STOP,
    recovered,
  }
}
