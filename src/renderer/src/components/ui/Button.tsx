/**
 * `Button`: primary (black) / secondary (outline) / ghost / danger variants,
 * sizes sm 28 / md 34 / lg 36, shapes pill / rounded. Keyboard focus = global `:focus-visible`.
 */
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Spinner } from './Spinner'
import './ui.css'

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium',
    'transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)]',
    'active:scale-[.97] active:duration-[var(--dur-instant)]',
    'disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-[var(--ui-accent-hover)]',
        secondary:
          'border border-border bg-bg text-fg hover:border-border-strong hover:bg-surface active:bg-[var(--pressed)]',
        ghost: 'text-fg hover:bg-[var(--hover)] active:bg-[var(--pressed)]',
        danger: 'border border-border bg-bg text-danger hover:bg-danger-soft active:bg-danger-soft',
      },
      size: {
        sm: 'h-7 px-3 text-small',
        md: 'h-[34px] px-4 text-ui',
        lg: 'h-9 px-5 text-ui',
      },
      shape: { pill: 'rounded-full', rounded: 'rounded-lg' },
    },
    defaultVariants: { variant: 'secondary', size: 'md', shape: 'pill' },
  },
)

export interface ButtonProps
  extends Omit<ComponentProps<'button'>, 'color'>, VariantProps<typeof buttonVariants> {
  /** Icon before the label (replaced by the spinner during `loading`). */
  icon?: ReactNode
  /** Shows a spinner and disables the button. */
  loading?: boolean
  /** Renders the child (e.g. a link) with the button styling. */
  asChild?: boolean
}

export function Button({
  variant,
  size,
  shape,
  icon,
  loading = false,
  asChild = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, shape }), className)
  if (asChild) {
    return (
      <Slot.Root className={classes} {...rest}>
        {children}
      </Slot.Root>
    )
  }
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={14} label={null} /> : icon}
      {children}
    </button>
  )
}
