/**
 * URL des médias côté renderer. Les DTO portent déjà des URL `recolt://` résolues
 * par main (repli compris) : le renderer ne construit aucun chemin et refuse tout http(s).
 * Mode maquette (dev) : `recolt://mock/...` → `/__mock/media/...` (middleware Vite, même origine).
 */
import type { ItemCard } from '../../../shared/dto/items'

export function isRecoltUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('recolt://')
}

/** `src` utilisable dans `<img>`/`<video>`, ou `undefined` (monogramme / squelette). */
export function mediaSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  if (/^https?:/i.test(url)) {
    if (import.meta.env.DEV) console.error(`[media-url] URL http(s) refusée dans un DTO : ${url}`)
    return undefined
  }
  if (import.meta.env.DEV && url.startsWith('recolt://mock/')) {
    return `/__mock/media/${url.slice('recolt://mock/'.length)}`
  }
  return url
}

/** Vignette de grille : `thumb` (déjà résolu par main), sinon affiche vidéo. */
export function cardThumbSrc(card: Pick<ItemCard, 'thumbUrl' | 'posterUrl'>): string | undefined {
  return mediaSrc(card.thumbUrl ?? card.posterUrl)
}

/** Grande image (viewer, Retina) : `large`, sinon original, sinon vignette. */
export function cardLargeSrc(
  card: Pick<ItemCard, 'largeUrl' | 'originalUrl' | 'thumbUrl'>,
): string | undefined {
  return mediaSrc(card.largeUrl ?? card.originalUrl ?? card.thumbUrl)
}
