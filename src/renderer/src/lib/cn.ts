/**
 * `cn()` : clsx + tailwind-merge avec le thème `text` étendu.
 * Sans l'extension, tailwind-merge classe `text-caption`… comme des COULEURS et supprime
 * silencieusement l'un des deux dans `cn('text-caption', 'text-fg-faint')`.
 */
import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** Tailles de texte du design system (tokens `--text-*` de `tokens.css`). */
export const TEXT_SIZES = [
  'micro',
  'caption',
  'small',
  'ui',
  'body',
  'tab',
  'nav',
  'title',
  'display',
] as const

const twMerge = extendTailwindMerge({
  extend: { theme: { text: [...TEXT_SIZES] } },
})

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))
