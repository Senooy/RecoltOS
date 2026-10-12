/**
 * Route and layer registry. Each screen is lazily loaded from its component
 * file; until that file exists, a stub is shown.
 * Convention: the file exports the default component (`export default function …`).
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { OverlayType, RouteName } from '../state/ui'

type Loader = () => Promise<{ default: ComponentType }>

/** Modules present at build time (none if the screen does not exist yet). */
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

/** Screen → component file. */
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

/** True if the screen's file exists. */
export function isRouteImplemented(name: RouteName): boolean {
  return ROUTE_FILES[name] in modules
}

/** True if the layer's file exists. */
export function isOverlayImplemented(name: OverlayType): boolean {
  return OVERLAY_FILES[name] in modules
}
