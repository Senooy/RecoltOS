/**
 * Raccourcis renderer du domaine `sync`, possédé par WP-57 (ERRATA §F). Les raccourcis de menu
 * restent dans `src/shared/shortcuts.ts` (Fable) : ne jamais rebinder ici un accélérateur de menu.
 */
import type { RendererShortcut } from './types'

export const syncShortcuts: readonly RendererShortcut[] = []
