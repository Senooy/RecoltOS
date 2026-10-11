/**
 * Glyphes de marque dessinés pour RecoltOS (DESIGN §4.1, §0 indépendant) : SVG minimalistes,
 * `currentColor`, utilisés uniquement pour identifier la source d'un élément (usage nominatif).
 * Aucune dépendance (pas de `simple-icons`).
 */
import type { SVGProps } from 'react'

export interface GlyphProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  /** Côté en px. */
  size?: number
  /** Nom accessible ; absent = glyphe décoratif (masqué aux lecteurs d'écran). */
  label?: string
}

function a11y(label: string | undefined) {
  return label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const }
}

/** X (ex-Twitter) : deux diagonales croisées, la montante plus fine. */
export function XGlyph({ size = 18, label, ...rest }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      {...a11y(label)}
      {...rest}
    >
      <path d="M5 4.5 19 19.5" strokeWidth="2.6" />
      <path d="M19 4.5 5 19.5" strokeWidth="1.5" />
    </svg>
  )
}

/** Instagram : carré arrondi, objectif, voyant. */
export function InstagramGlyph({ size = 18, label, ...rest }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      {...a11y(label)}
      {...rest}
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Cosmos : un disque et son orbite décentrée. */
export function CosmosGlyph({ size = 18, label, ...rest }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      {...a11y(label)}
      {...rest}
    >
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
      <path d="M5.2 15.2c3.4 1.6 9.4-.4 13.6-5.4" />
    </svg>
  )
}
