/**
 * Nœuds média (SPACES §1.4.4, DESIGN §3.11) : `ItemNode` réutilise les cartes de la bibliothèque
 * (post via `TweetCard` rendu à 360 px puis mis à l'échelle, page via `PageCard`, image via
 * `CardImage` dont le `srcset` choisit 800w / 1440w selon la taille À L'ÉCRAN), `ImageNode` pour
 * les assets (vignette ou original selon la taille à l'écran). Vidéos : vignette ; lecteur muet
 * seulement pour les ≤ 3 vidéos actives. Contenu inerte (`pointer-events: none`).
 */
import type { ItemCard } from '../../../../../../shared/dto/items'
import type { SpaceNode } from '../../../../../../shared/spaces-schema'
import { MediaBadge } from '../../../../components/ui'
import { fr } from '../../../../i18n/fr'
import { mediaSrc } from '../../../../lib/media-url'
import { CardImage, PageCard } from '../../../grid/cards/MediaCards'
import { cardKind } from '../../../grid/cards/SaveCard'
import { TweetCard } from '../../../grid/cards/TweetCard'

/** Largeur de rendu d'une carte de post avant mise à l'échelle (SPACES §1.2.3). */
export const POST_RENDER_WIDTH = 360
/** Côté des vignettes d'assets (`makeThumb` 800 px). */
export const THUMB_MAX_EDGE = 800

type ItemN = Extract<SpaceNode, { type: 'item' }>
type ImageN = Extract<SpaceNode, { type: 'image' }>

export function MissingNode() {
  return <div className="sp-missing">{fr.spaces.itemDeleted}</div>
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
      <CardImage
        thumbUrl={kind === 'video' ? (card.thumbUrl ?? card.posterUrl) : card.thumbUrl}
        largeUrl={card.largeUrl}
        width={node.width * screenScale}
        className={`h-full w-full ${fit}`}
      />
      {videoActive && preview ? (
        <video
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
