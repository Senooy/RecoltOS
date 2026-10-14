/**
 * Route and layer registry. Each screen is lazily loaded from its component
 * file; until that file exists, a stub is shown.
 * Convention: the file exports the default component (`export default function …`).
 *
 * Preloading: React 19 reveals a suspended boundary at least 300 ms after its fallback was shown
 * (`FALLBACK_THROTTLE_MS`), even when the chunk arrives in a few ms. A screen rendered through
 * `React.lazy` before its chunk is loaded therefore costs ~300 ms (startup grid, first opening
 * of the detail view, ⌘K, Settings, Rediscover). The initial screen is preloaded before the
 * first render, the others when the renderer is idle; a loaded screen is rendered directly,
 * without suspending.
 */
import { lazy, useState, type ComponentType } from 'react'
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

/** Screen component that can be loaded ahead of its first render. */
export interface PreloadableScreen {
  (): React.JSX.Element
  preload(): Promise<void>
}

function screen(name: string, file: string): PreloadableScreen {
  const load = loaderFor(name, file)
  let loaded: ComponentType | null = null
  let pending: Promise<{ default: ComponentType }> | null = null
  const get = () =>
    (pending ??= load().then((m) => {
      loaded = m.default
      return m
    }))
  const Lazy = lazy(get)
  function Screen() {
    // Chosen once per mount: a chunk arriving later never remounts a mounted screen.
    const [C] = useState<ComponentType>(() => loaded ?? Lazy)
    return <C />
  }
  Screen.preload = () =>
    get().then(
      () => undefined,
      () => undefined,
    )
  return Screen
}

export const routes = Object.fromEntries(
  Object.entries(ROUTE_FILES).map(([name, file]) => [name, screen(name, file)]),
) as Record<RouteName, PreloadableScreen>

export const overlays = Object.fromEntries(
  Object.entries(OVERLAY_FILES).map(([name, file]) => [name, screen(name, file)]),
) as Record<OverlayType, PreloadableScreen>

/**
 * Loads the other screens one by one while the renderer is idle (after the first paint), the most
 * frequent first: their first opening no longer waits for a chunk nor React's reveal throttle.
 */
export function preloadScreensWhenIdle(): void {
  const order: PreloadableScreen[] = [
    overlays.viewer,
    overlays.palette,
    routes.search,
    routes.shelf,
    routes.collection,
    overlays.settings,
    overlays.rediscover,
    routes.spaces,
    routes.space,
  ]
  const idle = (cb: () => void) =>
    typeof requestIdleCallback === 'function'
      ? requestIdleCallback(cb, { timeout: 3_000 })
      : setTimeout(cb, 200)
  const next = (i: number) => {
    const s = order[i]
    if (!s) return
    idle(() => void s.preload().then(() => next(i + 1)))
  }
  next(0)
}

/** True if the screen's file exists. */
export function isRouteImplemented(name: RouteName): boolean {
  return ROUTE_FILES[name] in modules
}

/** True if the layer's file exists. */
export function isOverlayImplemented(name: OverlayType): boolean {
  return OVERLAY_FILES[name] in modules
}
