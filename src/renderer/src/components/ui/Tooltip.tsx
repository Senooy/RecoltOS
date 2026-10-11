/**
 * `Tooltip` (DESIGN §2.4) : apparaît après 600 ms, animation `--dur-base`, raccourci optionnel.
 * Chaque instance embarque son `Provider` : aucun montage global requis.
 */
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Kbd } from './Kbd'
import { TOOLTIP_DELAY_MS } from './motion'
import { usePortalContainer } from './portal-container'
import './ui.css'

export const TooltipProvider = TooltipPrimitive.Provider

export interface TooltipProps {
  /** Texte de l'infobulle (FR). */
  content: ReactNode
  /** Raccourci affiché à droite du texte. */
  shortcut?: readonly string[]
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  /** Désactive l'infobulle sans changer l'arbre. */
  disabled?: boolean
  /** Contrôle externe (tests, cas particuliers). */
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  delayDuration?: number
  /** Élément déclencheur (un seul enfant, reçoit les props de Radix). */
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
  children,
  ...root
}: TooltipProps) {
  const container = usePortalContainer()
  // `disabled` ne ferme que l'ouverture : l'arbre Provider > Root > Trigger reste le même, donc
  // l'enfant n'est jamais démonté (focus et état conservés, menu ancré intact) même si la prop bascule.
  const rootProps = disabled ? { open: false } : root
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={300}>
      <TooltipPrimitive.Root {...rootProps}>
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
