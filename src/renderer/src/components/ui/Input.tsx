/**
 * `Input`: 34 px field, radius 10 (Settings) or 8 + dark background
 * (`viewer` variant, Details panel). Hover: border `--border-strong`. Keyboard focus
 * comes from `:focus-visible` (globals.css), never from a Tailwind "focus" variant.
 */
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn'

const inputVariants = cva(
  [
    'h-[34px] w-full min-w-0 select-text border text-ui',
    'transition-[border-color,background-color] duration-[var(--dur-fast)]',
    'disabled:pointer-events-none disabled:opacity-40 read-only:cursor-default',
  ],
  {
    variants: {
      variant: {
        default:
          'rounded-lg border-border bg-bg px-3 text-fg placeholder:text-fg-faint hover:border-border-strong',
        viewer:
          'rounded-md border-[var(--viewer-input-border)] bg-[var(--viewer-input)] px-3 text-[var(--viewer-fg)] placeholder:text-[var(--viewer-fg-subtle)] hover:border-[var(--viewer-fg-subtle)]',
      },
      invalid: { true: 'border-danger hover:border-danger', false: '' },
    },
    defaultVariants: { variant: 'default', invalid: false },
  },
)

export interface InputProps
  extends
    Omit<ComponentProps<'input'>, 'size'>,
    Omit<VariantProps<typeof inputVariants>, 'invalid'> {
  invalid?: boolean
  /** Element on the right inside the field (e.g. "open" button). */
  trailing?: ReactNode
}

export function Input({
  variant,
  invalid,
  trailing,
  className,
  type = 'text',
  ...rest
}: InputProps) {
  const field = (
    <input
      type={type}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      className={cn(
        inputVariants({ variant, invalid: invalid ?? false }),
        trailing ? 'pr-9' : '',
        className,
      )}
      {...rest}
    />
  )
  if (!trailing) return field
  return (
    <span className="relative inline-flex w-full items-center">
      {field}
      <span className="absolute right-2 flex items-center">{trailing}</span>
    </span>
  )
}
