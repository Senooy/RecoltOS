/**
 * Logo RecoltOS « Germe double » : une graine pointue et deux feuilles symétriques (même silhouette
 * que l'icône de l'app, `scripts/make-icon.mts`), en version plate : tuile arrondie `--fg`, symbole `--bg`.
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
    <svg viewBox="0 0 100 100" width={size} height={size} {...a11y} {...rest}>
      <rect width="100" height="100" rx="22.5" fill="var(--fg)" />
      <g transform="translate(-2 -7.2) scale(1.04)" fill="var(--bg)">
        <path d="M50 52C60 59 73 66 73 76C73 85 63 90 50 90C37 90 27 85 27 76C27 66 40 59 50 52Z" />
        <path d="M47 45C30 46 18 38 17 21C34 20 46 28 47 45Z" />
        <path d="M53 45C54 28 66 20 83 21C82 38 70 46 53 45Z" />
      </g>
    </svg>
  )
}
