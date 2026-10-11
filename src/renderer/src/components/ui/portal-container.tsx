/**
 * Conteneur des portails (menus, popovers, dialogues, infobulles). Par défaut Radix portale dans
 * `document.body`, donc hors de tout sous-arbre `data-theme` local : un sous-arbre sombre ou une
 * surface immersive (viewer) peut fournir ici son propre élément pour que les tokens s'appliquent.
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

/** Élément fourni par le plus proche `PortalContainerProvider` (null = `document.body`). */
export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined
}
