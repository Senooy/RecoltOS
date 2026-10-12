/**
 * Nœuds média : `ItemNode` réutilise les cartes de la bibliothèque
 * (post via `TweetCard` rendu à 360 px puis mis à l'échelle, page via `PageCard`), image via
 * `SpaceImage` : variante choisie EXPLICITEMENT (pas de `srcset`) selon la largeur en pixels
 * physiques (`node.width × palier(zoom × DPR)`) : vignette 800w tant qu'elle suffit, `large`
 * 1440w au-delà, jamais l'original. Un `srcset` gardait la 1440w en cache une fois
 * chargée, même revenu en vue d'ensemble. `ImageNode` pour les assets (vignette, original
 * seulement quand la vignette ne suffit plus : les assets n'ont pas de variante 1440w).
 * Vidéos : affiche ; lecteur muet seulement pour les ≤ 2 vidéos actives (survolées,
 * sélectionnées ou grandes à l'écran), libéré au démontage. Contenu inerte (`pointer-events: none`).
 */
import type { ItemCard } from '../../../../../../shared/dto/items'
import type { SpaceNode } from '../../../../../../shared/spaces-schema'
import { useState, type SyntheticEvent } from 'react'
import { MediaBadge } from '../../../../components/ui'
import { tr } from '../../../../i18n'
import { mediaSrc } from '../../../../lib/media-url'
import { releaseOnUnmount } from '../../../../lib/video-guard'
import { PageCard } from '../../../grid/cards/MediaCards'
import { cardKind } from '../../../grid/cards/SaveCard'
import { TweetCard } from '../../../grid/cards/TweetCard'

/** Largeur de rendu d'une carte de post avant mise à l'échelle. */
export const POST_RENDER_WIDTH = 360
/** Côté des vignettes d'assets (`makeThumb` 800 px). */
export const THUMB_MAX_EDGE = 800
/** Largeur des vignettes dérivées (`thumbs/` 800w). */
export const THUMB_W = 800
/**
 * Agrandissement toléré de la vignette avant de passer à `large` (1440w) : 1,2 × 800 = 960 px
 * physiques, soit un nœud de 320 px jusqu'à 150 % en Retina. Invisible sur une photo, et c'est le
 * palier du niveau de détail juste au-dessus de 100 % (zoom × DPR = 3 → 960 px).
 */
export const THUMB_UPSCALE = 1.2

/**
 * Variante d'image d'un nœud de la toile pour `devicePx` pixels physiques de large. La vignette
 * n'est une vraie 800w que si elle est dérivée (`thumbs/….webp`) ; sinon (repli `legacyThumb`,
 * `display`…) on prend `large` s'il existe.
 */
export function pickSpaceVariant(
  thumb: string | undefined,
  large: string | undefined,
  devicePx: number,
): string | undefined {
  const derived = Boolean(thumb?.includes('/thumbs/') && thumb.includes('.webp'))
  if (!large) return thumb
  if (!thumb || !derived) return large
  return devicePx <= THUMB_W * THUMB_UPSCALE + 0.5 ? thumb : large
}

/** Image d'un nœud `item` : `src` explicite (voir `pickSpaceVariant`), décodage asynchrone. */
function SpaceImage({
  thumbUrl,
  largeUrl,
  devicePx,
  className,
}: {
  thumbUrl: string | null
  largeUrl: string | null
  devicePx: number
  className: string
}) {
  const [loaded, setLoaded] = useState(false)
  const src = pickSpaceVariant(mediaSrc(thumbUrl), mediaSrc(largeUrl), devicePx)
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      crossOrigin="anonymous"
      decoding="async"
      loading="lazy"
      draggable={false}
      data-loaded={loaded ? '1' : '0'}
      className={`card-img ${className}`}
      onLoad={() => setLoaded(true)}
      onError={(e: SyntheticEvent<HTMLImageElement>) => {
        e.currentTarget.style.visibility = 'hidden'
      }}
    />
  )
}

type ItemN = Extract<SpaceNode, { type: 'item' }>
type ImageN = Extract<SpaceNode, { type: 'image' }>

export function MissingNode() {
  return <div className="sp-missing">{tr.spaces.itemDeleted}</div>
}

export function ItemNodeView({
  node,
  card,
  screenScale,
  videoActive,
}: {
  node: ItemN
  card: ItemCard | undefined
  /** zoom × devicePixelRatio (niveau de détail). */
  screenScale: number
  videoActive: boolean
}) {
  if (!card) return <MissingNode />
  const kind = cardKind(card)
  const radius = node.style.radius
  if (kind === 'tweet') {
    const s = node.width / POST_RENDER_WIDTH
    return (
      <div className="h-full w-full overflow-hidden" style={{ borderRadius: radius }}>
        <div
          style={{
            width: POST_RENDER_WIDTH,
            height: node.height / s,
            transform: `scale(${s})`,
            transformOrigin: '0 0',
          }}
        >
          <TweetCard card={card} className="h-full" />
        </div>
      </div>
    )
  }
  if (kind === 'page') {
    return (
      <div className="h-full w-full overflow-hidden bg-surface" style={{ borderRadius: radius }}>
        <PageCard card={card} width={node.width} />
      </div>
    )
  }
  const fit = node.style.fit === 'contain' ? 'object-contain' : 'object-cover'
  const preview = kind === 'video' ? mediaSrc(card.previewUrl) : undefined
  return (
    <div
      className="sp-media relative"
      style={{ borderRadius: radius, background: card.dominant ?? 'var(--skeleton)' }}
    >
      <SpaceImage
        thumbUrl={kind === 'video' ? (card.thumbUrl ?? card.posterUrl) : card.thumbUrl}
        largeUrl={card.largeUrl}
        devicePx={node.width * screenScale}
        className={`h-full w-full ${fit}`}
      />
      {videoActive && preview ? (
        <video
          ref={releaseOnUnmount}
          src={preview}
          muted
          loop
          autoPlay
          playsInline
          preload="auto"
          className={`absolute inset-0 h-full w-full ${fit}`}
        />
      ) : null}
      {kind === 'video' ? <MediaBadge kind="video" className="absolute right-2 top-2" /> : null}
      {kind === 'carousel' ? (
        <span className="absolute right-2 top-2 rounded-full bg-[rgba(0,0,0,.45)] px-1.5 text-[11px] leading-[18px] text-white tnum">
          1/{card.mediaCount}
        </span>
      ) : null}
    </div>
  )
}

export function ImageNodeView({
  node,
  screenScale,
  videoActive,
}: {
  node: ImageN
  screenScale: number
  videoActive: boolean
}) {
  const full = mediaSrc(node.assetUrl)
  const thumb = mediaSrc(node.assetThumbUrl)
  const video = node.style.kind === 'video'
  const big = Math.max(node.width, node.height) * screenScale > THUMB_MAX_EDGE
  const src = video ? (thumb ?? undefined) : big || !thumb ? full : thumb
  const fit = node.style.fit === 'contain' ? 'object-contain' : 'object-cover'
  return (
    <div className="sp-media relative" style={{ borderRadius: node.style.radius }}>
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          crossOrigin="anonymous"
          decoding="async"
          className={fit}
        />
      ) : null}
      {video && videoActive && full ? (
        <video
          ref={releaseOnUnmount}
          src={full}
          muted
          loop
          autoPlay
          playsInline
          preload="auto"
          className={`absolute inset-0 ${fit}`}
        />
      ) : null}
      {video ? <MediaBadge kind="video" className="absolute right-2 top-2" /> : null}
    </div>
  )
}
