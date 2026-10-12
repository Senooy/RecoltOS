/**
 * `Dialog`: Radix modal. Scrim `modal` (--scrim-modal + 3 px blur,
 * Settings) or `palette` (--scrim-palette, no blur), both no-drag. Panel: opacity,
 * scale .98→1 and y −6→0 (240 ms); fade only under reduced motion. The title is required
 * (`title`), visually hideable (`hideTitle`) but always announced.
 */
import { X } from 'lucide-react'
import { Dialog as DialogPrimitive, VisuallyHidden } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { UI_LABELS } from './labels'
import { usePortalContainer } from './portal-container'
import './ui.css'

export type DialogScrim = 'modal' | 'palette'

export interface DialogContentProps extends Omit<
  ComponentProps<typeof DialogPrimitive.Content>,
  'title' | 'children'
> {
  /** Title (French): announced by screen readers even if `hideTitle`. */
  title: string
  hideTitle?: boolean
  /** Optional description (below the title). */
  description?: ReactNode
  /** "Close" button at the top right (X 14 px, 28 px area). */
  showClose?: boolean
  scrim?: DialogScrim
  /** Panel content (the title and close button are added). */
  children?: ReactNode
}

function DialogContent({
  title,
  hideTitle = false,
  description,
  showClose = true,
  scrim = 'modal',
  className,
  children,
  ...rest
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal container={usePortalContainer()}>
      <DialogPrimitive.Overlay
        className={cn(
          'ui-scrim overlay fixed inset-0 z-[75]',
          scrim === 'modal' ? 'ui-scrim-modal' : 'ui-scrim-palette',
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          'ui-dialog app-no-drag fixed left-1/2 top-1/2 z-[75] flex max-h-[calc(100vh-80px)] w-[min(420px,calc(100vw-48px))] flex-col',
          'rounded-2xl bg-bg text-fg shadow-[var(--shadow-modal)]',
          className,
        )}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...rest}
      >
        {hideTitle ? (
          <VisuallyHidden.Root asChild>
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          </VisuallyHidden.Root>
        ) : (
          <DialogPrimitive.Title className="px-5 pt-5 text-title font-semibold">
            {title}
          </DialogPrimitive.Title>
        )}
        {description ? (
          <DialogPrimitive.Description className="px-5 pt-1.5 text-small text-fg-muted">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            aria-label={UI_LABELS.close}
            className="absolute right-[18px] top-4 -m-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors duration-[var(--dur-fast)] hover:bg-[var(--hover)] hover:text-fg"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export const Dialog = {
  Root: DialogPrimitive.Root,
  Trigger: DialogPrimitive.Trigger,
  Close: DialogPrimitive.Close,
  Content: DialogContent,
} as const
