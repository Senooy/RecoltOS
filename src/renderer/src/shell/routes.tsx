/**
 * Registre des routes et calques. Chaque écran est chargé paresseusement depuis son fichier de
 * composant ; tant que ce fichier n'existe pas, un stub s'affiche.
 * Convention : le fichier exporte le composant par défaut (`export default function …`).
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { OverlayType, RouteName } from '../state/ui'

type Loader = () => Promise<{ default: ComponentType }>

/** Modules présents au build (aucun si l'écran n'existe pas encore). */
const modules = import.meta.glob<{ default: ComponentType }>([
  '../features/library/LibraryPage.tsx',
  '../features/collections/CollectionPage.tsx',
  '../features/collections/shelf/CollectionShelf.tsx',
  '../features/search/SearchPage.tsx',
  '../features/spaces/SpacesHome.tsx',
  '../features/spaces/SpaceEditor.tsx',
  '../features/viewer/Viewer.tsx',
  '../features/rediscover/Rediscover.tsx',
  '../features/palette/CommandPalette.tsx',
  '../features/settings/SettingsDialog.tsx',
])

/** Écran → fichier de composant . */
export const ROUTE_FILES: Readonly<Record<RouteName, string>> = {
  library: '../features/library/LibraryPage.tsx',
  collection: '../features/collections/CollectionPage.tsx',
  shelf: '../features/collections/shelf/CollectionShelf.tsx',
  search: '../features/search/SearchPage.tsx',
  spaces: '../features/spaces/SpacesHome.tsx',
  space: '../features/spaces/SpaceEditor.tsx',
}

export const OVERLAY_FILES: Readonly<Record<OverlayType, string>> = {
  viewer: '../features/viewer/Viewer.tsx',
  rediscover: '../features/rediscover/Rediscover.tsx',
  palette: '../features/palette/CommandPalette.tsx',
  settings: '../features/settings/SettingsDialog.tsx',
}

function stub(name: string): Loader {
  function StubView() {
    return <div data-testid={`stub-${name}`} hidden />
  }
  return () => Promise.resolve({ default: StubView })
}

function loaderFor(name: string, file: string): Loader {
  return modules[file] ?? stub(name)
}

export const routes = Object.fromEntries(
  Object.entries(ROUTE_FILES).map(([name, file]) => [name, lazy(loaderFor(name, file))]),
) as Record<RouteName, LazyExoticComponent<ComponentType>>

export const overlays = Object.fromEntries(
  Object.entries(OVERLAY_FILES).map(([name, file]) => [name, lazy(loaderFor(name, file))]),
) as Record<OverlayType, LazyExoticComponent<ComponentType>>

/** Vrai si le fichier de l'écran existe. */
export function isRouteImplemented(name: RouteName): boolean {
  return ROUTE_FILES[name] in modules
}

/** Vrai si le fichier du calque existe. */
export function isOverlayImplemented(name: OverlayType): boolean {
  return OVERLAY_FILES[name] in modules
}
