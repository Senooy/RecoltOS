/**
 * Cartes média (DESIGN §3.2) : `ImageCard`, `VideoCard` (affiche, aperçu muet au survol après
 * 150 ms, une seule vidéo à la fois, jamais l'original), `CarouselCard` (badge « 1/N », chevrons
 * verre au survol), `PageCard` (capture + titre + domaine). Images `thumb` 800w et `large` 1440w
 * en `srcset` : nettes en Retina.
 */
import { ChevronLeft, ChevronRight, Globe } from 'lucide-react'
import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import type { ItemCard, Slide } from '../../../../../shared/dto/items'
import { MediaBadge } from '../../../components/ui'
import { fr } from '../../../i18n/fr'
import { mediaSrc } from '../../../lib/media-url'
import { rpc } from '../../../lib/rpc'

export function CardImage({
  thumbUrl,
  largeUrl,
  width,
  alt = '',
  className = 'h-full w-full object-cover',
}: {
  thumbUrl: string | null
  largeUrl: string | null
  /** Largeur affichée (px CSS) : `sizes` du srcset. */
  width: number
  alt?: string
  className?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const thumb = mediaSrc(thumbUrl)
  const large = mediaSrc(largeUrl)
  if (!thumb && !large) return null
  // Le srcset n'annonce 800w que pour une vraie vignette dérivée (`thumbs/…webp`).
  const derived = thumb?.includes('/thumbs/') && thumb.includes('.webp')
  const srcSet = large && derived ? `${thumb} 800w, ${large} 1440w` : undefined
  return (
    <img
      src={thumb ?? large}
      {...(srcSet ? { srcSet, sizes: `${Math.round(width)}px` } : {})}
      alt={alt}
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

export function ImageCard({ card, width }: { card: ItemCard; width: number }) {
  const gif = card.isAnimated || card.mime === 'image/gif'
  return (
    <>
      <CardImage thumbUrl={card.thumbUrl} largeUrl={card.largeUrl} width={width} />
      {gif ? <MediaBadge kind="gif" className="absolute right-2 top-2" /> : null}
    </>
  )
}

/** Une seule vidéo de survol à la fois dans toute la grille. */
let playing: HTMLVideoElement | null = null

export function VideoCard({
  card,
  width,
  hover,
}: {
  card: ItemCard
  width: number
  hover: boolean
}) {
  const ref = useRef<HTMLVideoElement | null>(null)
  const [active, setActive] = useState(false)
  const [progress, setProgress] = useState(0)
  const preview = mediaSrc(card.previewUrl)
  const e2e = document.documentElement.dataset.e2e === '1'
  useEffect(() => {
    if (!hover || !preview || e2e) {
      setActive(false)
      return
    }
    const t = setTimeout(() => setActive(true), 150)
    return () => clearTimeout(t)
  }, [hover, preview, e2e])
  useEffect(() => {
    const v = ref.current
    if (!active || !v) return
    if (playing && playing !== v) playing.pause()
    playing = v
    v.currentTime = 0
    void v.play().catch(() => undefined)
    return () => {
      v.pause()
      if (playing === v) playing = null
    }
  }, [active])
  return (
    <>
      <CardImage
        thumbUrl={card.thumbUrl ?? card.posterUrl}
        largeUrl={card.largeUrl}
        width={width}
      />
      {active && preview ? (
        <>
          <video
            ref={ref}
            src={preview}
            muted
            loop
            playsInline
            preload="auto"
            className="absolute inset-0 h-full w-full object-cover"
            onTimeUpdate={(e) => {
              const v = e.currentTarget
              if (v.duration > 0) setProgress(v.currentTime / v.duration)
            }}
          />
          <span
            className="absolute bottom-0 left-0 h-0.5 bg-[rgba(255,255,255,.6)]"
            style={{ width: `${progress * 100}%` }}
          />
        </>
      ) : null}
      {card.mediaCount < 2 ? <MediaBadge kind="video" className="absolute right-2 top-2" /> : null}
    </>
  )
}

const slideCache = new Map<string, Slide[]>()

export function CarouselCard({ card, width }: { card: ItemCard; width: number }) {
  const [index, setIndex] = useState(0)
  const [slides, setSlides] = useState<Slide[] | null>(() => slideCache.get(card.uuid) ?? null)
  const n = card.mediaCount
  const go = async (e: React.MouseEvent, delta: number) => {
    e.stopPropagation()
    e.preventDefault()
    let list = slides
    if (!list) {
      try {
        const d = await rpc('items.get', { uuid: card.uuid })
        list = d.slides
        slideCache.set(card.uuid, list)
        setSlides(list)
      } catch {
        return
      }
    }
    const count = Math.max(1, list.length)
    setIndex((i) => (i + delta + count) % count)
  }
  const slide = index > 0 && slides ? slides[index] : null
  const total = slides ? slides.length : n
  return (
    <>
      {slide ? (
        <CardImage
          key={slide.uuid}
          thumbUrl={slide.thumbUrl}
          largeUrl={slide.largeUrl}
          width={width}
        />
      ) : (
        <CardImage
          thumbUrl={card.thumbUrl ?? card.posterUrl}
          largeUrl={card.largeUrl}
          width={width}
        />
      )}
      <MediaBadge
        kind="carousel"
        label={`${index + 1}/${total}`}
        className="absolute right-2 top-2"
      />
      <button
        type="button"
        aria-label={fr.viewer.previous}
        className="carousel-nav glass absolute left-2 top-1/2 flex h-[26px] w-[26px] -translate-y-1/2 items-center justify-center rounded-full"
        onClick={(e) => void go(e, -1)}
      >
        <ChevronLeft size={15} strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label={fr.viewer.next}
        className="carousel-nav glass absolute right-2 top-1/2 flex h-[26px] w-[26px] -translate-y-1/2 items-center justify-center rounded-full"
        onClick={(e) => void go(e, 1)}
      >
        <ChevronRight size={15} strokeWidth={2} />
      </button>
    </>
  )
}

export const PAGE_FOOTER_H = 56
export const PAGE_RATIO = 0.6

export function PageCard({ card, width }: { card: ItemCard; width: number }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-border-subtle bg-surface">
      <div
        className="relative w-full shrink-0 overflow-hidden"
        style={{ height: Math.round(width * PAGE_RATIO) }}
      >
        <CardImage
          thumbUrl={card.thumbUrl}
          largeUrl={card.largeUrl}
          width={width}
          className="h-full w-full object-cover object-top"
        />
      </div>
      <div className="min-h-0 px-3 pb-3 pt-2.5">
        <div className="page-title text-small font-medium text-fg">
          {card.title ?? card.sourceHost ?? ''}
        </div>
        {card.sourceHost ? (
          <div className="mt-0.5 flex items-center gap-1 text-caption text-fg-subtle">
            <Globe size={12} strokeWidth={1.75} />
            <span className="truncate">{card.sourceHost}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
