/**
 * Registre des routes et calques (PLAN §1.26). Possédé par WP-00 puis Fable : les lots ne
 * l'éditent pas. Chaque écran est chargé paresseusement depuis le fichier de composant qu'un
 * lot possède (DESIGN §4.2) ; tant que ce fichier n'existe pas, un stub s'affiche.
 * Convention : le fichier exporte le composant par défaut (`export default function …`).
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { OverlayType, RouteName } from '../state/ui'

type Loader = () => Promise<{ default: ComponentType }>

/** Modules présents au build (aucun si le lot n'est pas encore livré). */
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

/** Écran → fichier de composant (et lot propriétaire). */
export const ROUTE_FILES: Readonly<Record<RouteName, string>> = {
  library: '../features/library/LibraryPage.tsx', // WP-15
  collection: '../features/collections/CollectionPage.tsx', // WP-20
  shelf: '../features/collections/shelf/CollectionShelf.tsx', // WP-21
  search: '../features/search/SearchPage.tsx', // WP-22
  spaces: '../features/spaces/SpacesHome.tsx', // WP-62
  space: '../features/spaces/SpaceEditor.tsx', // WP-62
}

export const OVERLAY_FILES: Readonly<Record<OverlayType, string>> = {
  viewer: '../features/viewer/Viewer.tsx', // WP-30
  rediscover: '../features/rediscover/Rediscover.tsx', // WP-32
  palette: '../features/palette/CommandPalette.tsx', // WP-23
  settings: '../features/settings/SettingsDialog.tsx', // WP-16
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

/** Vrai si le lot propriétaire a livré l'écran. */
export function isRouteImplemented(name: RouteName): boolean {
  return ROUTE_FILES[name] in modules
}
