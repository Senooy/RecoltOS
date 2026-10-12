/**
 * `PillBar`: floating pill for toasts and the selection bar. 40 px high,
 * `rounded-full`, `--surface` background, `--shadow-toast`, padding `0 6 0 16`, 13 px text.
 * `PillBar.Action`: 28 px black pill; `PillBar.Ghost`: subtle action ("Hide"...).
 */
import { cva } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import './ui.css'

/** Pill classes, shared with `Toaster` (sonner in `unstyled` mode). */
export const PILL_CLASS =
  'flex h-10 items-center gap-2 rounded-full bg-surface pl-4 pr-1.5 text-small text-fg shadow-[var(--shadow-toast)]'

export const pillActionVariants = cva(
  [
    'inline-flex h-7 shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-small font-medium',
    'transition-[background-color,color,transform] duration-[var(--dur-fast)] active:scale-[.97]',
    'disabled:pointer-events-none disabled:opacity-40',
    '[&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:[stroke-width:1.75]',
  ],
  {
    variants: {
      tone: {
        primary: 'bg-accent text-accent-fg hover:bg-[var(--ui-accent-hover)]',
        ghost: 'text-fg hover:bg-[var(--hover)]',
        danger: 'text-danger hover:bg-danger-soft',
      },
    },
    defaultVariants: { tone: 'primary' },
  },
)

export interface PillBarProps extends ComponentProps<'div'> {
  /** Centered at the bottom of the window (`fixed`, bottom 24); otherwise in normal flow. */
  floating?: boolean
  /** Accessible name of the group (recommended: the bar carries a message announced to screen readers). */
  'aria-label'?: string
}

function PillBarRoot({ floating = false, className, ...rest }: PillBarProps) {
  return (
    <div
      role="group"
      {...rest}
      className={cn(
        PILL_CLASS,
        'app-no-drag',
        floating && 'fixed bottom-6 left-1/2 z-40 -translate-x-1/2',
        className,
      )}
    />
  )
}

function PillAction({
  tone,
  className,
  type = 'button',
  ...rest
}: ComponentProps<'button'> & { tone?: 'primary' | 'ghost' | 'danger' }) {
  return <button type={type} className={cn(pillActionVariants({ tone }), className)} {...rest} />
}

export const PillBar = Object.assign(PillBarRoot, { Action: PillAction })
