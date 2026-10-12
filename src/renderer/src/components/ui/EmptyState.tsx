/**
 * `EmptyState`: icon, title, description, action. `dark` variant for immersive
 * surfaces (shelf, viewer).
 */
import { cva } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

const root = cva('flex flex-col items-center justify-center text-center', {
  variants: {
    tone: {
      default: 'text-fg',
      dark: 'text-[var(--viewer-fg)]',
    },
  },
})

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  /** Action buttons (black primary + outline secondary). */
  action?: ReactNode
  variant?: 'default' | 'dark'
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'default',
  className,
}: EmptyStateProps) {
  const dark = variant === 'dark'
  return (
    <div className={cn(root({ tone: variant }), 'gap-1 px-6 py-10', className)}>
      {icon ? (
        <span
          aria-hidden="true"
          className={cn(
            'mb-3 inline-flex [&_svg]:h-7 [&_svg]:w-7 [&_svg]:[stroke-width:1.5]',
            dark ? 'text-[var(--viewer-fg-muted)]' : 'text-fg-faint',
          )}
        >
          {icon}
        </span>
      ) : null}
      <h2 className="text-tab font-semibold">{title}</h2>
      {description ? (
        <p
          className={cn(
            'max-w-[360px] text-small',
            dark ? 'text-[var(--viewer-fg-muted)]' : 'text-fg-muted',
          )}
        >
          {description}
        </p>
      ) : null}
      {action ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>
      ) : null}
    </div>
  )
}
