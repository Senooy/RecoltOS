/**
 * Media URLs on the renderer side. DTOs already carry `recolt://` URLs resolved
 * by main (fallback included): the renderer builds no path and refuses any http(s).
 * Mock mode (dev): `recolt://mock/...` → `/__mock/media/...` (Vite middleware, same origin).
 */
import type { ItemCard } from '../../../shared/dto/items'

export function isRecoltUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('recolt://')
}

/** `src` usable in `<img>`/`<video>`, or `undefined` (monogram / skeleton). */
export function mediaSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  if (/^https?:/i.test(url)) {
    if (import.meta.env.DEV) console.error(`[media-url] http(s) URL refused in a DTO: ${url}`)
    return undefined
  }
  if (import.meta.env.DEV && url.startsWith('recolt://mock/')) {
    return `/__mock/media/${url.slice('recolt://mock/'.length)}`
  }
  return url
}

/** Grid thumbnail: `thumb` (already resolved by main), otherwise the video poster. */
export function cardThumbSrc(card: Pick<ItemCard, 'thumbUrl' | 'posterUrl'>): string | undefined {
  return mediaSrc(card.thumbUrl ?? card.posterUrl)
}

/** Large image (viewer, Retina): `large`, otherwise original, otherwise thumbnail. */
export function cardLargeSrc(
  card: Pick<ItemCard, 'largeUrl' | 'originalUrl' | 'thumbUrl'>,
): string | undefined {
  return mediaSrc(card.largeUrl ?? card.originalUrl ?? card.thumbUrl)
}
