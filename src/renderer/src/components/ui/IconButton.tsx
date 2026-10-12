/**
 * `IconButton`: square/round icon button. `label` is REQUIRED (French):
 * it becomes `aria-label` AND tooltip (with the shortcut). tones: ghost / outline / glass /
 * viewer; sizes sm 24 / md 28 / lg 32. Glyphs with a 1.75 stroke like the captures.
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
  /** Icon (lucide, SVG…). */
  icon: ReactNode
  /** Accessible name (French) + tooltip text. */
  label: string
  /** Shortcut shown in the tooltip. */
  shortcut?: readonly string[]
  /** `false`: no tooltip (the button keeps its `aria-label`). */
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
    throw new Error('IconButton: `label` (the accessible name) is required and cannot be empty.')
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
