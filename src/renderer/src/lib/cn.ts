/**
 * `cn()`: clsx + tailwind-merge with the `text` theme extended.
 * Without the extension, tailwind-merge classes `text-caption`… as COLORS and silently removes
 * one of the two in `cn('text-caption', 'text-fg-faint')`.
 */
import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** Design system text sizes (`--text-*` tokens from `tokens.css`). */
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
