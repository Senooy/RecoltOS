/**
 * `SaveCard`: common base (radius 8, background `palette[0]` or `--skeleton`, selection dot
 * on hover) and dispatch by type: post → `TweetCard`, ≥ 2 slides → `CarouselCard`,
 * video → `VideoCard`, image → `ImageCard`, page → `PageCard`.
 */
import { Check } from 'lucide-react'
import {
  memo,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import type { ItemCard } from '../../../../../shared/dto/items'
import { tr } from '../../../i18n'
import { cn } from '../../../lib/cn'
import { CarouselCard, ImageCard, PageCard, VideoCard } from './MediaCards'
import { TweetCard } from './TweetCard'

export type CardKind = 'tweet' | 'carousel' | 'video' | 'image' | 'page'

export function cardKind(c: Pick<ItemCard, 'kind' | 'mediaCount'>): CardKind {
  if (c.kind === 'tweet') return 'tweet'
  if (c.kind === 'url') return 'page'
  if (c.mediaCount >= 2) return 'carousel'
  return c.kind === 'video' ? 'video' : 'image'
}

export function cardLabel(c: ItemCard): string {
  if (c.title) return c.title
  const h = c.post?.author.handle
  return h ? tr.card.imageOf(h) : c.kind === 'video' ? tr.card.video : tr.nav.library
}

export interface SaveCardProps {
  card: ItemCard
  width: number
  height: number
  selected: boolean
  style?: CSSProperties
  className?: string
  onActivate: (e: MouseEvent | KeyboardEvent, card: ItemCard) => void
  onToggleSelect: (e: MouseEvent, card: ItemCard) => void
  onDragStart?: (e: DragEvent<HTMLDivElement>, card: ItemCard) => void
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>, card: ItemCard) => void
}

function SaveCardInner({
  card,
  width,
  height,
  selected,
  style,
  className,
  onActivate,
  onToggleSelect,
  onDragStart,
  onKeyDown,
}: SaveCardProps) {
  const [hover, setHover] = useState(false)
  const kind = cardKind(card)
  const framed = kind === 'tweet' || kind === 'page'
  return (
    <div
      role="listitem"
      tabIndex={-1}
      data-testid="card"
      data-kind={card.kind}
      data-card-kind={kind}
      data-uuid={card.uuid}
      data-selected={selected ? '1' : '0'}
      aria-label={cardLabel(card)}
      draggable
      className={cn('save-card group overflow-hidden rounded-md', className)}
      style={{
        width,
        height,
        background: framed ? undefined : (card.dominant ?? 'var(--skeleton)'),
        ...style,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => {
        if (e.metaKey || e.shiftKey || e.ctrlKey) onToggleSelect(e, card)
        else onActivate(e, card)
      }}
      onDragStart={(e) => onDragStart?.(e, card)}
      onKeyDown={(e) => onKeyDown?.(e, card)}
    >
      <div className="relative h-full w-full">
        {kind === 'tweet' ? (
          <TweetCard card={card} className="h-full" />
        ) : kind === 'page' ? (
          <PageCard card={card} width={width} />
        ) : kind === 'carousel' ? (
          <CarouselCard card={card} width={width} />
        ) : kind === 'video' ? (
          <VideoCard card={card} width={width} hover={hover} />
        ) : (
          <ImageCard card={card} width={width} />
        )}
        <button
          type="button"
          aria-label={tr.card.select}
          aria-pressed={selected}
          className={cn(
            'select-dot absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border-[1.5px]',
            selected
              ? 'border-white bg-white'
              : 'border-[rgba(255,255,255,.9)] bg-[rgba(0,0,0,.18)]',
          )}
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect(e, card)
          }}
        >
          {selected ? <Check size={12} strokeWidth={3} color="#0a0a0a" /> : null}
        </button>
      </div>
    </div>
  )
}

export const SaveCard = memo(SaveCardInner)
