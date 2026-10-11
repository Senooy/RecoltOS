/**
 * `FormatBadge` (DESIGN §3.7) : « MP4 », « JPG », « WEBP », « GIF », « PAGE », « POST ».
 * 11 px, graisse 700, blanc sur `--viewer-chip`, rayon 6, padding 3 7.
 */
import { cn } from '../../lib/cn'

export type FormatName = 'MP4' | 'JPG' | 'WEBP' | 'GIF' | 'PAGE' | 'POST' | 'PNG' | (string & {})

export interface FormatBadgeProps {
  format: FormatName
  className?: string
}

export function FormatBadge({ format, className }: FormatBadgeProps) {
  return (
    <span
      data-format={format.toUpperCase()}
      className={cn(
        'inline-flex select-none items-center rounded-sm bg-[var(--viewer-chip)] px-[7px] py-[3px] text-micro font-bold leading-[14px] tracking-normal text-white',
        className,
      )}
    >
      {format.toUpperCase()}
    </span>
  )
}
