/**
 * `MediaBadge`: corner badges for cards. `video`: 24×20, camera icon 13 px;
 * `carousel`: "1/N", 22 px high; `gif`: "GIF". Background `--badge-bg` + 8 px blur, white text.
 */
import { Video } from 'lucide-react'
import { cn } from '../../lib/cn'
import { UI_LABELS } from './labels'

export type MediaBadgeKind = 'video' | 'carousel' | 'gif'

export interface MediaBadgeProps {
  kind: MediaBadgeKind
  /** Carousel: "1/6". Optional for video and gif. */
  label?: string
  className?: string
}

const BASE =
  'inline-flex select-none items-center justify-center bg-[var(--badge-bg)] text-white backdrop-blur-[8px] tnum'

export function MediaBadge({ kind, label, className }: MediaBadgeProps) {
  if (kind === 'video') {
    return (
      <span
        role="img"
        aria-label={UI_LABELS.video}
        className={cn(BASE, 'h-5 w-6 rounded-sm', className)}
      >
        <Video aria-hidden="true" className="h-[13px] w-[13px]" strokeWidth={2} />
      </span>
    )
  }
  if (kind === 'gif') {
    return (
      <span
        className={cn(
          BASE,
          'h-5 rounded-sm px-1.5 text-micro font-bold tracking-normal',
          className,
        )}
      >
        {label ?? UI_LABELS.gif}
      </span>
    )
  }
  return (
    <span className={cn(BASE, 'h-[22px] rounded-full px-2 text-caption font-semibold', className)}>
      {label}
    </span>
  )
}
