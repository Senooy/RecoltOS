/**
 * Container for portals (menus, popovers, dialogs, tooltips). By default Radix portals into
 * `document.body`, so outside any local `data-theme` subtree: a dark subtree or an immersive
 * surface (viewer) can provide its own element here so that the tokens apply.
 */
import { createContext, useContext, type ReactNode } from 'react'

const PortalContainerContext = createContext<HTMLElement | null>(null)

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null
  children: ReactNode
}) {
  return <PortalContainerContext value={container}>{children}</PortalContainerContext>
}

/** Element provided by the nearest `PortalContainerProvider` (null = `document.body`). */
export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined
}
