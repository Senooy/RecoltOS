/**
 * État d'interface (zustand) : route, calques, sélection, glisser interne, colonnes par vue,
 * graine de recherche (`ui.openSearch`, ERRATA §B).
 */
import { create } from 'zustand'
import type { LibraryTab } from '../../../shared/enums'

export type Route =
  | { name: 'library' }
  | { name: 'collection'; uuid: string }
  | { name: 'shelf' }
  | { name: 'search' }
  | { name: 'spaces' }
  | { name: 'space'; uuid: string }

export type RouteName = Route['name']

export type SettingsSection =
  'appearance' | 'libraries' | 'ai' | 'tags' | 'capture' | 'sync' | 'storage' | 'data' | 'about'

export type Overlay =
  | { type: 'viewer'; uuid: string; ids?: string[] }
  | { type: 'rediscover'; collectionUuid?: string }
  | { type: 'palette' }
  | { type: 'settings'; section?: SettingsSection }

export type OverlayType = Overlay['type']

export interface SearchSeed {
  query?: string
  color?: string
  tag?: string
}

export interface UiState {
  route: Route
  previous: Route | null
  libraryTab: LibraryTab
  overlay: Overlay | null
  selection: string[]
  internalDrag: string[] | null
  /** Incrémenté à chaque `openSearch` pour que la page applique la graine. */
  search: SearchSeed & { nonce: number }
  /** Colonnes par vue (`library`, `collection:<uuid>`…), 2 à 8. */
  columns: Record<string, number>

  navigate: (route: Route) => void
  back: () => void
  setLibraryTab: (tab: LibraryTab) => void
  openOverlay: (overlay: Overlay) => void
  closeOverlay: () => void
  setSelection: (uuids: string[]) => void
  toggleSelected: (uuid: string) => void
  clearSelection: () => void
  setInternalDrag: (uuids: string[]) => void
  clearInternalDrag: () => void
  openSearch: (seed?: SearchSeed) => void
  setColumns: (viewKey: string, n: number) => void
}

export const clampColumns = (n: number): number => Math.min(8, Math.max(2, Math.round(n)))

export const useUi = create<UiState>()((set, get) => ({
  route: { name: 'library' },
  previous: null,
  libraryTab: 'all',
  overlay: null,
  selection: [],
  internalDrag: null,
  search: { nonce: 0 },
  columns: {},

  navigate: (route) => set((s) => ({ route, previous: s.route, selection: [] })),
  back: () => {
    const prev = get().previous
    set({ route: prev ?? { name: 'library' }, previous: null, selection: [] })
  },
  setLibraryTab: (libraryTab) => set({ libraryTab, selection: [] }),
  openOverlay: (overlay) => set({ overlay }),
  closeOverlay: () => set({ overlay: null }),
  setSelection: (selection) => set({ selection: [...new Set(selection)] }),
  toggleSelected: (uuid) =>
    set((s) => ({
      selection: s.selection.includes(uuid)
        ? s.selection.filter((u) => u !== uuid)
        : [...s.selection, uuid],
    })),
  clearSelection: () => set({ selection: [] }),
  setInternalDrag: (uuids) => set({ internalDrag: uuids }),
  clearInternalDrag: () => set({ internalDrag: null }),
  openSearch: (seed = {}) =>
    set((s) => ({
      route: { name: 'search' },
      previous: s.route.name === 'search' ? s.previous : s.route,
      overlay: null,
      search: { ...seed, nonce: s.search.nonce + 1 },
    })),
  setColumns: (viewKey, n) =>
    set((s) => ({ columns: { ...s.columns, [viewKey]: clampColumns(n) } })),
}))
