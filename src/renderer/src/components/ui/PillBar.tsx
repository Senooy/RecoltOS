/**
 * `PillBar` (DESIGN §2.7) : pilule flottante des toasts et de la barre de sélection. 40 px de
 * haut, `rounded-full`, fond `--surface`, `--shadow-toast`, padding `0 6 0 16`, texte 13 px.
 * `PillBar.Action` : pilule noire de 28 px ; `PillBar.Ghost` : action discrète (« Masquer »…).
 */
import { cva } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/** Classes de la pilule, partagées avec `Toaster` (sonner en mode `unstyled`). */
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
  /** Centrée en bas de la fenêtre (`fixed`, bottom 24) ; sinon en flux normal. */
  floating?: boolean
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
