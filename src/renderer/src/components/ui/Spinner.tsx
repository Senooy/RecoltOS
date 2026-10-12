/**
 * Loading indicator: a rotating circular arc (color = `currentColor`).
 * Reduced motion: the arc stays fixed (`ui.css`), the accessible name is enough.
 */
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import { UI_LABELS } from './labels'
import './ui.css'

export interface SpinnerProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Side length in px (16 by default). */
  size?: number
  /** Accessible name; `null` for a decorative spinner (the parent already conveys the state). */
  label?: string | null
}

export function Spinner({
  size = 16,
  label = UI_LABELS.loading,
  className,
  style,
  ...rest
}: SpinnerProps) {
  const a11y = label === null ? { 'aria-hidden': true } : { role: 'status', 'aria-label': label }
  return (
    <span
      {...a11y}
      {...rest}
      className={cn('ui-spinner inline-flex shrink-0 text-current', className)}
      style={{ width: size, height: size, ...style }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="2.5"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}
