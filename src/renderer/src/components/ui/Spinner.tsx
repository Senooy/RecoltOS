/**
 * Indicateur de chargement : arc de cercle qui tourne (couleur = `currentColor`).
 * Mouvement réduit : l'arc reste fixe (`ui.css`), le nom accessible suffit.
 */
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import { UI_LABELS } from './labels'
import './ui.css'

export interface SpinnerProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Côté en px (16 par défaut). */
  size?: number
  /** Nom accessible ; `null` pour un spinner décoratif (le parent porte déjà l'état). */
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
