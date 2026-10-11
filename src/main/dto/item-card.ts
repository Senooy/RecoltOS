/**
 * DTO de grille `ItemCard` (PLAN §4.3, ARCHI §8) : URL `recolt://` résolues ici (repli compris),
 * vue de post `PostView` (texte tronqué à 600, auteur avec avatar local ou `null` → monogramme,
 * images citées seulement si déjà téléchargées). Aucune URL http(s) ne sort.
 */
import type { ItemCard, PostAuthorView, PostView, QuotedPostView } from '../../shared/dto/items'
import { POST_VIEW_TEXT_MAX, parsePostMeta, type PostMeta } from '../../shared/post-meta'
import type { CardRow } from '../db/queries/list'
import { remoteRelFor } from '../library/remote-index'
import { assetUrlOrNull, avatarUrl, resolveMediaUrls } from '../protocol/urls'

export interface DtoLib {
  id: string
  root: string
}

const HEX = /^#[0-9a-f]{6}$/i

function firstHex(palette: string | null): string | null {
  if (!palette) return null
  try {
    const v: unknown = JSON.parse(palette)
    const h: unknown = Array.isArray(v) ? (v as unknown[])[0] : null
    return typeof h === 'string' && HEX.test(h) ? h.toLowerCase() : null
  } catch {
    return null
  }
}

export function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

function truncate(text: string | null, max = POST_VIEW_TEXT_MAX): string | null {
  if (text === null) return null
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** URL `recolt://…/remote/…` d'une image distante déjà téléchargée, sinon rien. */
export function remoteImageUrls(lib: DtoLib, urls: readonly (string | null)[]): string[] {
  const out: string[] = []
  for (const u of urls) {
    if (!u) continue
    const rel = remoteRelFor(lib.root, u)
    const url = rel ? assetUrlOrNull(lib.id, rel) : null
    if (url) out.push(url)
  }
  return out
}

export function postView(
  lib: DtoLib,
  meta: PostMeta | null,
  author: {
    name: string | null
    handle: string | null
    avatarRel: string | null
    avatarStatus: string | null
    updatedAt: number | null
  },
): PostView | null {
  if (!meta) return null
  const a: PostAuthorView = {
    name: author.name ?? meta.author?.name ?? null,
    handle: author.handle ?? meta.author?.handle ?? null,
    avatarUrl:
      author.avatarStatus === 'ok' ? avatarUrl(lib.id, author.avatarRel, author.updatedAt) : null,
  }
  let quoted: QuotedPostView | null = null
  if (meta.quoted) {
    quoted = {
      author: meta.quoted.author
        ? { name: meta.quoted.author.name, handle: meta.quoted.author.handle, avatarUrl: null }
        : null,
      text: truncate(meta.quoted.text, 400),
      imageUrls: remoteImageUrls(
        lib,
        meta.quoted.media.map((m) => m.remoteUrl),
      ),
    }
  }
  return { author: a, text: truncate(meta.text), quoted, threadCount: meta.thread.length }
}

export function toItemCard(lib: DtoLib, r: CardRow): ItemCard {
  const urls = resolveMediaUrls(
    lib.id,
    r.m_media_type
      ? {
          media_type: r.m_media_type,
          status: r.m_status ?? 'ok',
          file_rel: r.m_file_rel,
          thumb_rel: r.m_thumb_rel,
          large_rel: r.m_large_rel,
          poster_rel: r.m_poster_rel,
          preview_rel: r.m_preview_rel,
          display_rel: r.m_display_rel,
          legacy_thumb_rel: r.m_legacy_thumb_rel,
          derive_version: r.m_derive_version ?? 0,
        }
      : null,
  )
  const meta = r.post_meta ? parsePostMeta(r.post_meta) : null
  const pos = (n: number | null) => (n !== null && n > 0 ? Math.round(n) : null)
  return {
    uuid: r.uuid,
    kind: r.kind as ItemCard['kind'],
    source: r.source as ItemCard['source'],
    title: r.title ?? r.ai_title ?? null,
    width: pos(r.m_width),
    height: pos(r.m_height),
    mediaCount: Math.max(r.live_media, r.m_media_type ? 1 : 0),
    mime: r.m_mime,
    isAnimated: r.m_is_animated === 1,
    durationMs: r.m_duration_ms,
    dominant: firstHex(r.palette),
    hasNotes: Boolean(r.notes && r.notes.trim()),
    createdAt: r.created_at,
    displayDate: r.created_at,
    viewCount: r.view_count,
    ...urls,
    post: postView(lib, meta, {
      name: r.a_name,
      handle: r.a_handle,
      avatarRel: r.a_avatar_rel,
      avatarStatus: r.a_avatar_status,
      updatedAt: r.a_updated_at,
    }),
    sourceHost: hostOf(r.source_url),
  }
}
