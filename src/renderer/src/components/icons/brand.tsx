/**
 * Brand glyphs drawn for RecoltOS: minimalist SVGs, `currentColor`, used only to identify
 * the source of an item (nominative use). No dependency (no `simple-icons`).
 */
import type { SVGProps } from 'react'

export interface GlyphProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  /** Side length in px. */
  size?: number
  /** Accessible name; absent = decorative glyph (hidden from screen readers). */
  label?: string
}

function a11y(label: string | undefined) {
  return label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const }
}

/**
 * X logo (formerly Twitter), in-house geometry: the descending diagonal is a hollowed band
 * (outline of a parallelogram), the rising one a thin bar interrupted by the band. Solid fill
 * (`evenodd`): definitely not two crossed strokes, which would be mistaken for a close cross.
 */
export const X_LOGO_PATH =
  'M2.5 3H8.2L21.5 21H15.8Z' +
  'M4.89 4.2L16.41 19.8H19.11L7.59 4.2Z' +
  'M19.65 3H21.55L14.02 10.88L13.19 9.76Z' +
  'M9.98 13.12L10.81 14.24L4.34 21H2.44Z'

export function XGlyph({ size = 18, label, ...rest }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      fillRule="evenodd"
      data-glyph="x"
      {...a11y(label)}
      {...rest}
    >
      <path d={X_LOGO_PATH} />
    </svg>
  )
}

/** Instagram: rounded square, lens, dot. */
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

/** Cosmos: a disc and its off-center orbit. */
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
