/**
 * URL média des DTO : main construit `recolt://<libraryId>/<rel>?v=<n>`,
 * le renderer ne manipule jamais de chemin. Chaîne de repli résolue ICI, pas dans le renderer :
 *   image : thumbUrl = thumb ?? legacyThumb ?? display ?? original
 *   vidéo : thumbUrl = thumb ?? poster ?? legacyThumb ?? null
 * Pas d'import `electron` : utilisé par les DTO (…) et testé sous Node.
 */
import type { MediaRow } from '../db/repos/media'
import { LibraryId, MEDIA_ROOTS, MediaUrl } from '../../shared/enums'
import { RECOLT_PROTOCOL } from './recolt-protocol'

const MEDIA_ROOT_SET: ReadonlySet<string> = new Set(MEDIA_ROOTS)

/**
 * `recolt://<libId>/<rel>?v=<v>`. `rel` est relatif à la racine de la bibliothèque et commence par
 * une racine servie (`thumbs/…`, `items/…`). Lève si l'URL ne serait pas servie (racine inconnue,
 * `..`, segment vide, antislash) : une erreur de construction se voit tout de suite.
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
  // `?v` seulement pour un entier fini : NaN / Infinity produiraient `?v=NaN` (URL acceptée par
  // MediaUrl, mais sans sens). Une version invalide n'empêche pas l'affichage, elle est omise.
  const query =
    typeof v === 'number' && Number.isFinite(v) ? `?v=${Math.max(0, Math.trunc(v))}` : ''
  const url = `${RECOLT_PROTOCOL}://${libId}/${encoded}${query}`
  // Dernier contrôle : la forme exacte acceptée par le contrat (`MediaUrl`).
  if (!MediaUrl.safeParse(url).success) {
    throw new Error(`URL média invalide : ${JSON.stringify(url)}`)
  }
  return url
}

/** `assetUrl` qui rend `null` pour un chemin absent ou non servi (donnée importée abîmée). */
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

/** Colonnes de `item_media` lues pour construire les URL. */
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
  /** `null` tant que le dérivé manque. */
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
 * URL d'un média (`?v=derive_version` : un nouveau dérivé change l'URL, l'ancien reste en cache
 * `immutable`). L'original n'est pas exposé s'il est distant (`remote`) ou perdu (`missing`).
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

/** Avatar d'auteur : `?v=authors.updated_at` ; `null` → monogramme. */
export function avatarUrl(
  libId: string,
  avatarRel: string | null | undefined,
  updatedAt: number | null | undefined,
): string | null {
  return assetUrlOrNull(libId, avatarRel, updatedAt ?? null)
}
