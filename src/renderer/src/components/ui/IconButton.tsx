/**
 * `IconButton` : bouton d'icône carré/rond. `label` est OBLIGATOIRE (FR) :
 * il devient `aria-label` ET infobulle (avec le raccourci). tones : ghost / outline / glass /
 * viewer ; tailles sm 24 / md 28 / lg 32. Glyphes à trait 1,75 comme les captures.
 */
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Tooltip } from './Tooltip'
import './ui.css'

export const iconButtonVariants = cva(
  [
    'inline-flex shrink-0 select-none items-center justify-center',
    'transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)]',
    'active:scale-[.97] active:duration-[var(--dur-instant)]',
    'disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40',
    '[&_svg]:shrink-0 [&_svg]:[stroke-width:1.75]',
  ],
  {
    variants: {
      size: {
        sm: 'h-6 w-6 [&_svg]:h-3.5 [&_svg]:w-3.5',
        md: 'h-7 w-7 [&_svg]:h-[18px] [&_svg]:w-[18px]',
        lg: 'h-8 w-8 [&_svg]:h-[18px] [&_svg]:w-[18px]',
      },
      tone: {
        ghost:
          'rounded-md text-fg-subtle hover:bg-[var(--hover)] hover:text-fg active:bg-[var(--pressed)]',
        outline:
          'rounded-md border border-border text-fg-subtle hover:border-border-strong hover:bg-surface hover:text-fg',
        glass: 'glass rounded-full text-fg hover:bg-surface',
        viewer:
          'rounded-full bg-[var(--viewer-btn)] text-[var(--viewer-fg)] hover:bg-[var(--ui-viewer-btn-hover)]',
      },
    },
    defaultVariants: { size: 'md', tone: 'ghost' },
  },
)

export interface IconButtonProps
  extends
    Omit<ComponentProps<'button'>, 'aria-label' | 'children' | 'title'>,
    VariantProps<typeof iconButtonVariants> {
  /** Icône (lucide, SVG…). */
  icon: ReactNode
  /** Nom accessible FR + texte de l'infobulle. */
  label: string
  /** Raccourci affiché dans l'infobulle. */
  shortcut?: readonly string[]
  /** `false` : pas d'infobulle (le bouton garde son `aria-label`). */
  tooltip?: boolean
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

export function IconButton({
  icon,
  label,
  shortcut,
  tooltip = true,
  tooltipSide = 'bottom',
  size,
  tone,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  if (label.trim() === '') {
    throw new Error(
      'IconButton : `label` (nom accessible FR) est obligatoire et ne peut pas être vide.',
    )
  }
  const button = (
    <button
      type={type}
      aria-label={label}
      className={cn(iconButtonVariants({ size, tone }), className)}
      {...rest}
    >
      {icon}
    </button>
  )
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide} disabled={!tooltip}>
      {button}
    </Tooltip>
  )
}
