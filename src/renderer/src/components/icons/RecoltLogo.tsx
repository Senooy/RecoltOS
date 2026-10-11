/**
 * Logo RecoltOS : un épi stylisé blanc sur carré arrondi `--fg` (dessin propre au projet).
 * Les couleurs suivent les tokens : il s'inverse avec le thème.
 */
import type { SVGProps } from 'react'

export interface RecoltLogoProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  /** Côté en px (28 dans l'en-tête, 56 dans À propos). */
  size?: number
  /** Nom accessible ; absent = décoratif. */
  label?: string
}

export function RecoltLogo({ size = 28, label, ...rest }: RecoltLogoProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const }
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} {...a11y} {...rest}>
      <rect width="28" height="28" rx="7" fill="var(--fg)" />
      <g stroke="var(--bg)" strokeWidth="1.8" strokeLinecap="round" fill="none">
        <path d="M14 21V8" />
        <path d="M14 12.5c-2.2-.4-3.6-1.8-4-4 2.2.3 3.6 1.7 4 4Z" />
        <path d="M14 12.5c2.2-.4 3.6-1.8 4-4-2.2.3-3.6 1.7-4 4Z" />
        <path d="M14 17c-2.2-.4-3.6-1.8-4-4 2.2.3 3.6 1.7 4 4Z" />
        <path d="M14 17c2.2-.4 3.6-1.8 4-4-2.2.3-3.6 1.7-4 4Z" />
      </g>
    </svg>
  )
}
