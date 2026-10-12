/**
 * `Tooltip`: appears after 600 ms, `--dur-base` animation, optional shortcut.
 * Each instance embeds its own `Provider`: no global mount required.
 */
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Kbd } from './Kbd'
import { TOOLTIP_DELAY_MS } from './motion'
import { usePortalContainer } from './portal-container'
import './ui.css'

export const TooltipProvider = TooltipPrimitive.Provider

export interface TooltipProps {
  /** Tooltip text (French). */
  content: ReactNode
  /** Shortcut shown to the right of the text. */
  shortcut?: readonly string[]
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  /** Disables the tooltip without changing the tree. */
  disabled?: boolean
  /** External control (tests, special cases). */
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  delayDuration?: number
  /** Trigger element (a single child, receives the Radix props). */
  children: ReactNode
}

export function Tooltip({
  content,
  shortcut,
  side = 'bottom',
  align = 'center',
  sideOffset = 6,
  disabled = false,
  delayDuration = TOOLTIP_DELAY_MS,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
}: TooltipProps) {
  const container = usePortalContainer()
  // `disabled` only blocks opening: the Provider > Root > Trigger tree stays the same, so the child
  // is never unmounted (focus and state kept, anchored menu intact) even if the prop toggles.
  // The Root always stays controlled (state managed here): no controlled/uncontrolled warning.
  const [innerOpen, setInnerOpen] = useState(defaultOpen)
  const isControlled = open !== undefined
  const isOpen = disabled ? false : (open ?? innerOpen)
  const handleOpenChange = (next: boolean) => {
    if (disabled) return
    if (!isControlled) setInnerOpen(next)
    onOpenChange?.(next)
  }
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={300}>
      <TooltipPrimitive.Root open={isOpen} onOpenChange={handleOpenChange}>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal container={container}>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={sideOffset}
            collisionPadding={8}
            className={cn(
              'ui-pop ui-pop-tooltip app-no-drag z-[70] flex max-w-[280px] items-center gap-2 rounded-md',
              'bg-surface px-2.5 py-1.5 text-caption font-medium text-fg shadow-[var(--shadow-popover)]',
            )}
          >
            <span>{content}</span>
            {shortcut && shortcut.length > 0 ? <Kbd keys={shortcut} size="xs" /> : null}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
