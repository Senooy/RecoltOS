/**
 * `Kbd` (DESIGN §2.5, §3.10, §3.8) : raccourcis clavier. `xs` (11 px, en-tête), `sm`, `md`
 * (Réglages : une touche = une boîte de 24×22). Mono pour les touches en lettres (« esc »).
 */
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

const kbdVariants = cva('inline-flex items-center justify-center whitespace-nowrap tnum', {
  variants: {
    size: {
      xs: 'rounded-[5px] px-[5px] py-px text-micro normal-case tracking-normal',
      sm: 'min-w-[18px] rounded-sm px-1.5 py-px text-caption font-medium',
      md: 'h-[22px] min-w-6 rounded-sm px-1 text-caption font-bold',
    },
    tone: {
      light: '',
      dark: 'bg-[var(--viewer-btn)] text-[var(--viewer-fg-muted)]',
      rediscover: 'bg-[var(--rd-kbd)] text-[var(--rd-counter)]',
    },
  },
  compoundVariants: [
    { size: ['xs', 'sm'], tone: 'light', class: 'bg-[var(--kbd-bg)] text-[var(--kbd-fg)]' },
    { size: 'md', tone: 'light', class: 'border border-border bg-surface text-fg' },
  ],
  defaultVariants: { size: 'xs', tone: 'light' },
})

export interface KbdProps
  extends Omit<ComponentProps<'span'>, 'children'>, VariantProps<typeof kbdVariants> {
  /** Touches, une entrée par touche : `['⌘', '⇧', 'S']`. */
  keys: readonly string[]
}

/** Deux lettres ASCII ou plus : « esc », « Tab » → police mono. */
const isWord = (s: string): boolean => /[A-Za-z]{2,}/.test(s)

export function Kbd({ keys, size = 'xs', tone = 'light', className, ...rest }: KbdProps) {
  const base = kbdVariants({ size, tone })
  if (size === 'md') {
    // Réglages : une boîte par touche, annoncée comme un seul raccourci.
    return (
      <span
        role="img"
        aria-label={keys.join(' ')}
        {...rest}
        className={cn('inline-flex items-center gap-1', className)}
      >
        {keys.map((k, i) => (
          <kbd key={`${k}-${i}`} aria-hidden="true" className={cn(base, isWord(k) && 'font-mono')}>
            {k}
          </kbd>
        ))}
      </span>
    )
  }
  const text = keys.join('')
  return (
    <span {...rest} className={cn('inline-flex', className)}>
      <kbd className={cn(base, isWord(text) && 'font-mono')}>{text}</kbd>
    </span>
  )
}
