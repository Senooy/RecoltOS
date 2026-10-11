/**
 * Raccourcis renderer du domaine `settings`, possédé par WP-16 (ERRATA §F). Les raccourcis de menu
 * restent dans `src/shared/shortcuts.ts` (Fable) : ne jamais rebinder ici un accélérateur de menu.
 */
import type { RendererShortcut } from './types'

export const settingsShortcuts: readonly RendererShortcut[] = []
