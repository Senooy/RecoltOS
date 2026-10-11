/**
 * `Chip` (DESIGN §4.3) : pastille pleine (`rounded-full`). Variantes `tag` (# nom), `recent`
 * (recherche récente), `filter` (bascule), `collection`, `viewer` (26 px, sur fond sombre).
 * Cliquable si `onClick`/`selected` est fourni (rend alors un `<button>`) ; `onRemove` ajoute
 * une croix distincte avec son propre nom accessible.
 */
import { cva } from 'class-variance-authority'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { UI_LABELS } from './labels'

export type ChipVariant = 'tag' | 'recent' | 'filter' | 'collection' | 'viewer'

const chip = cva(
  [
    'inline-flex max-w-full shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full border',
    'transition-[background-color,border-color,color] duration-[var(--dur-fast)]',
    '[&_svg]:shrink-0 [&_svg]:[stroke-width:1.75]',
  ],
  {
    variants: {
      variant: {
        tag: 'h-7 px-3 text-small',
        recent: 'h-7 px-3 text-small',
        filter: 'h-7 px-3 text-small',
        collection: 'h-7 px-3 text-small',
        viewer: 'h-[26px] px-2.5 text-[12.5px]',
      },
      state: {
        idle: '',
        selected: '',
      },
      interactive: { true: 'cursor-default', false: '' },
    },
    compoundVariants: [
      {
        variant: ['tag', 'recent', 'filter', 'collection'],
        state: 'idle',
        class: 'border-border bg-bg text-fg',
      },
      {
        variant: ['tag', 'recent', 'filter', 'collection'],
        state: 'idle',
        interactive: true,
        class: 'hover:border-border-strong hover:bg-surface',
      },
      {
        variant: ['tag', 'recent', 'filter', 'collection'],
        state: 'selected',
        class: 'border-accent bg-accent text-accent-fg',
      },
      {
        variant: 'viewer',
        state: 'idle',
        class: 'border-[var(--viewer-input-border)] bg-transparent text-[var(--viewer-fg-2)]',
      },
      {
        variant: 'viewer',
        state: 'idle',
        interactive: true,
        class: 'hover:bg-[var(--viewer-btn)]',
      },
      {
        variant: 'viewer',
        state: 'selected',
        class: 'border-[var(--viewer-fg)] bg-[var(--viewer-fg)] text-[var(--viewer-base)]',
      },
    ],
    defaultVariants: { variant: 'filter', state: 'idle', interactive: false },
  },
)

export interface ChipProps {
  label: string
  variant?: ChipVariant
  icon?: ReactNode
  selected?: boolean
  onClick?: () => void
  /** Ajoute une croix de retrait (nom accessible « Retirer <label> »). */
  onRemove?: () => void
  className?: string
  title?: string
}

export function Chip({
  label,
  variant = 'filter',
  icon,
  selected,
  onClick,
  onRemove,
  className,
  title,
}: ChipProps) {
  const interactive = Boolean(onClick) || selected !== undefined
  const classes = cn(
    chip({ variant, state: selected ? 'selected' : 'idle', interactive }),
    className,
  )
  const content = (
    <>
      {icon ? (
        <span className="inline-flex [&_svg]:h-3.5 [&_svg]:w-3.5" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {variant === 'tag' ? <span aria-hidden="true">#</span> : null}
      <span className="truncate">{label}</span>
    </>
  )
  const remove = onRemove ? (
    <button
      type="button"
      aria-label={UI_LABELS.remove(label)}
      onClick={onRemove}
      className="-mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100"
    >
      <X aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
    </button>
  ) : null

  if (interactive && !onRemove) {
    return (
      <button
        type="button"
        title={title}
        aria-pressed={selected}
        onClick={onClick}
        className={classes}
      >
        {content}
      </button>
    )
  }
  if (interactive && onRemove) {
    // Deux contrôles distincts : jamais de <button> imbriqué.
    return (
      <span className={classes} title={title}>
        <button
          type="button"
          aria-pressed={selected}
          onClick={onClick}
          className="inline-flex min-w-0 items-center gap-1.5"
        >
          {content}
        </button>
        {remove}
      </span>
    )
  }
  return (
    <span className={classes} title={title}>
      {content}
      {remove}
    </span>
  )
}
