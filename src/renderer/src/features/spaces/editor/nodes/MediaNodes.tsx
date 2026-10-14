/**
 * Media nodes: `ItemNode` reuses the library cards
 * (post via `TweetCard` rendered at 360 px then scaled, page via `PageCard`), image via
 * `SpaceImage`: variant chosen EXPLICITLY (no `srcset`) according to the width in physical pixels
 * (`node.width × palier(zoom × DPR)`): 800w thumbnail as long as it suffices, `large`
 * 1440w beyond that, never the original. A `srcset` kept the 1440w in cache once
 * loaded, even when back in the overview. `ImageNode` for assets (thumbnail, original
 * only when the thumbnail no longer suffices: assets have no 1440w variant).
 * Videos: poster shown; muted player only for ≤ 2 active videos (hovered,
 * selected or large on screen), released on unmount. Inert content (`pointer-events: none`).
 */
import type { ItemCard } from '../../../../../../shared/dto/items'
import type { SpaceNode } from '../../../../../../shared/spaces-schema'
import { useState, type SyntheticEvent } from 'react'
import { MediaBadge } from '../../../../components/ui'
import { tr } from '../../../../i18n'
import { mediaSrc } from '../../../../lib/media-url'
import { mountVideo } from '../../../../lib/video-guard'
import { PageCard } from '../../../grid/cards/MediaCards'
import { cardKind } from '../../../grid/cards/SaveCard'
import { TweetCard } from '../../../grid/cards/TweetCard'

/** Render width of a post card before scaling. */
export const POST_RENDER_WIDTH = 360
/** Edge of asset thumbnails (`makeThumb` 800 px). */
export const THUMB_MAX_EDGE = 800
/** Width of derived thumbnails (`thumbs/` 800w). */
export const THUMB_W = 800
/**
 * Tolerated enlargement of the thumbnail before switching to `large` (1440w): 1.2 × 800 = 960 px
 * physical, i.e. a 320 px node up to 150 % on Retina. Invisible on a photo, and it is the
 * level-of-detail step just above 100 % (zoom × DPR = 3 → 960 px).
 */
export const THUMB_UPSCALE = 1.2

/**
 * Image variant of a canvas node for `devicePx` physical pixels wide. The thumbnail
 * is a real 800w only if it is derived (`thumbs/….webp`); otherwise (fallback `legacyThumb`,
 * `display`…) we take `large` if it exists.
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

/** Image of an `item` node: explicit `src` (see `pickSpaceVariant`), asynchronous decoding. */
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
  /** zoom × devicePixelRatio (level of detail). */
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
          key={preview}
          ref={mountVideo}
          data-src={preview}
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
          key={full}
          ref={mountVideo}
          data-src={full}
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
