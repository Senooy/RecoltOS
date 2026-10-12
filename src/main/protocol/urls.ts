/**
 * Media URLs of the DTOs: main builds `recolt://<libraryId>/<rel>?v=<n>`,
 * the renderer never handles a path. The fallback chain is resolved HERE, not in the renderer:
 *   image : thumbUrl = thumb ?? legacyThumb ?? display ?? original
 *   video: thumbUrl = thumb ?? poster ?? legacyThumb ?? null
 * No `electron` import: used by the DTOs (…) and tested under Node.
 */
import type { MediaRow } from '../db/repos/media'
import { LibraryId, MEDIA_ROOTS, MediaUrl } from '../../shared/enums'
import { RECOLT_PROTOCOL } from './recolt-protocol'

const MEDIA_ROOT_SET: ReadonlySet<string> = new Set(MEDIA_ROOTS)

/**
 * `recolt://<libId>/<rel>?v=<v>`. `rel` is relative to the library root and starts with
 * a served root (`thumbs/…`, `items/…`). Throws if the URL would not be served (unknown root,
 * `..`, empty segment, backslash): a construction error is visible immediately.
 */
export function assetUrl(libId: string, rel: string, v?: number | null): string {
  if (!LibraryId.safeParse(libId).success) {
    throw new Error(`identifiant de bibliothèque invalide : ${JSON.stringify(libId)}`)
  }
  const segments = rel.split('/')
  if (
    segments.length < 2 ||
    !MEDIA_ROOT_SET.has(segments[0]!) ||
    segments.some(
      (s) => s === '' || s === '.' || s === '..' || s.includes('\\') || s.includes('\0'),
    )
  ) {
    throw new Error(`chemin média non servi : ${JSON.stringify(rel)}`)
  }
  const encoded = segments.map((s) => encodeURIComponent(s)).join('/')
  // `?v` only for a finite integer: NaN / Infinity would produce `?v=NaN` (URL accepted by
  // MediaUrl, but meaningless). An invalid version does not prevent display, it is omitted.
  const query =
    typeof v === 'number' && Number.isFinite(v) ? `?v=${Math.max(0, Math.trunc(v))}` : ''
  const url = `${RECOLT_PROTOCOL}://${libId}/${encoded}${query}`
  // Final check: the exact shape accepted by the contract (`MediaUrl`).
  if (!MediaUrl.safeParse(url).success) {
    throw new Error(`URL média invalide : ${JSON.stringify(url)}`)
  }
  return url
}

/** `assetUrl` returning `null` for a missing or unserved path (damaged imported data). */
export function assetUrlOrNull(
  libId: string,
  rel: string | null | undefined,
  v?: number | null,
): string | null {
  if (!rel) return null
  try {
    return assetUrl(libId, rel, v)
  } catch {
    return null
  }
}

/** `item_media` columns read to build the URLs. */
export type MediaUrlSource = Pick<
  MediaRow,
  | 'media_type'
  | 'status'
  | 'file_rel'
  | 'thumb_rel'
  | 'large_rel'
  | 'poster_rel'
  | 'preview_rel'
  | 'display_rel'
  | 'legacy_thumb_rel'
  | 'derive_version'
>

export interface MediaUrls {
  thumbUrl: string | null
  largeUrl: string | null
  posterUrl: string | null
  /** `null` while the derivative is missing. */
  previewUrl: string | null
  originalUrl: string | null
}

export const NO_MEDIA_URLS: Readonly<MediaUrls> = Object.freeze({
  thumbUrl: null,
  largeUrl: null,
  posterUrl: null,
  previewUrl: null,
  originalUrl: null,
})

/**
 * Media URL (`?v=derive_version`: a new derivative changes the URL, the old one stays cached
 * `immutable`). The original is not exposed if it is remote (`remote`) or lost (`missing`).
 */
export function resolveMediaUrls(libId: string, m: MediaUrlSource | null | undefined): MediaUrls {
  if (!m) return { ...NO_MEDIA_URLS }
  const v = m.derive_version
  const url = (rel: string | null | undefined) => assetUrlOrNull(libId, rel, v)
  const hasOriginal = m.status !== 'remote' && m.status !== 'missing'
  const original = hasOriginal ? url(m.file_rel) : null
  const thumb = url(m.thumb_rel)
  const large = url(m.large_rel)
  const display = url(m.display_rel)

  if (m.media_type === 'video') {
    const poster = url(m.poster_rel)
    return {
      thumbUrl: thumb ?? poster ?? url(m.legacy_thumb_rel) ?? null,
      largeUrl: large,
      posterUrl: poster,
      previewUrl: url(m.preview_rel),
      originalUrl: original,
    }
  }
  return {
    thumbUrl: thumb ?? url(m.legacy_thumb_rel) ?? display ?? original,
    largeUrl: large ?? display,
    posterUrl: null,
    previewUrl: null,
    originalUrl: original,
  }
}

/** Author avatar: `?v=authors.updated_at`; `null` → monogram. */
export function avatarUrl(
  libId: string,
  avatarRel: string | null | undefined,
  updatedAt: number | null | undefined,
): string | null {
  return assetUrlOrNull(libId, avatarRel, updatedAt ?? null)
}
