/**
 * `Popover`: floating Radix surface, radius 12, `--shadow-popover`, same
 * animation as the menus. Search filters, collection picker, technical info.
 */
import { Popover as PopoverPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import { usePortalContainer } from './portal-container'
import './ui.css'

function PopoverContent({
  className,
  sideOffset = 8,
  collisionPadding = 8,
  align = 'center',
  ...rest
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal container={usePortalContainer()}>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        align={align}
        className={cn(
          'ui-pop app-no-drag z-[80] rounded-xl bg-surface p-3 text-fg shadow-[var(--shadow-popover)]',
          className,
        )}
        {...rest}
      />
    </PopoverPrimitive.Portal>
  )
}

export const Popover = {
  Root: PopoverPrimitive.Root,
  Trigger: PopoverPrimitive.Trigger,
  Anchor: PopoverPrimitive.Anchor,
  Close: PopoverPrimitive.Close,
  Content: PopoverContent,
} as const
