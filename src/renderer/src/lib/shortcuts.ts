/**
 * Raccourcis côté renderer (DESIGN §3.13) : table unique `src/shared/shortcuts.ts` +
 * raccourcis propres à chaque domaine UI (`lib/shortcuts/<domaine>.ts`, liste FIGÉE).
 * AZERTY : chiffres par `e.code`, lettres par la touche imprimée (`getLayoutMap()` ou `e.key`).
 */
import {
  SHORTCUTS,
  type KeyMatch,
  type Modifiers,
  type ShortcutDef,
} from '../../../shared/shortcuts'
import { aiShortcuts } from './shortcuts/ai'
import { captureShortcuts } from './shortcuts/capture'
import { collectionShortcuts } from './shortcuts/collection'
import { colorShortcuts } from './shortcuts/color'
import { gridShortcuts } from './shortcuts/grid'
import { libraryShortcuts } from './shortcuts/library'
import { paletteShortcuts } from './shortcuts/palette'
import { rediscoverShortcuts } from './shortcuts/rediscover'
import { searchShortcuts } from './shortcuts/search'
import { settingsShortcuts } from './shortcuts/settings'
import { settingsMoreShortcuts } from './shortcuts/settings-more'
import { shelfShortcuts } from './shortcuts/shelf'
import { shellShortcuts } from './shortcuts/shell'
import { spacesShortcuts } from './shortcuts/spaces'
import { spacesExtraShortcuts } from './shortcuts/spaces-extra'
import { syncShortcuts } from './shortcuts/sync'
import { viewerShortcuts } from './shortcuts/viewer'
import type { RendererShortcut } from './shortcuts/types'

export type { RendererShortcut } from './shortcuts/types'
export { SHORTCUTS }

/** Raccourcis renderer de tous les domaines (agrégés). */
export const DOMAIN_SHORTCUTS: Readonly<Record<string, readonly RendererShortcut[]>> = {
  shell: shellShortcuts,
  grid: gridShortcuts,
  library: libraryShortcuts,
  settings: settingsShortcuts,
  collection: collectionShortcuts,
  shelf: shelfShortcuts,
  search: searchShortcuts,
  palette: paletteShortcuts,
  'settings-more': settingsMoreShortcuts,
  viewer: viewerShortcuts,
  color: colorShortcuts,
  rediscover: rediscoverShortcuts,
  capture: captureShortcuts,
  ai: aiShortcuts,
  sync: syncShortcuts,
  spaces: spacesShortcuts,
  'spaces-extra': spacesExtraShortcuts,
}

export interface KeyboardLike {
  key: string
  code: string
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
}

let layoutMap: Map<string, string> | null = null

/** Carte de disposition (`navigator.keyboard.getLayoutMap()`), relue au focus de la fenêtre. */
export async function initLayoutMap(): Promise<void> {
  const kb = (
    navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }
  ).keyboard
  if (!kb) return
  try {
    layoutMap = await kb.getLayoutMap()
  } catch {
    layoutMap = null
  }
}

/** Lettre imprimée en minuscule, insensible à ⌥ et ⇧ (⌥A ne donne pas « å »). */
export function baseChar(e: KeyboardLike): string {
  const fromMap = layoutMap?.get(e.code)
  if (fromMap) return fromMap.toLowerCase()
  if (e.altKey && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase()
  return e.key.length === 1 ? e.key.toLowerCase() : e.key
}

export function isDigit(e: KeyboardLike, n: number): boolean {
  return e.code === `Digit${n}` || e.code === `Numpad${n}` || e.key === String(n)
}

function modsMatch(e: KeyboardLike, m: Modifiers, ignoreShift = false): boolean {
  return (
    e.metaKey === Boolean(m.meta) &&
    e.altKey === Boolean(m.alt) &&
    e.ctrlKey === Boolean(m.ctrl) &&
    (ignoreShift || e.shiftKey === Boolean(m.shift))
  )
}

export function matchesKey(e: KeyboardLike, m: KeyMatch & Modifiers): boolean {
  switch (m.kind) {
    case 'letter':
      return modsMatch(e, m) && baseChar(e) === m.key
    case 'digit':
      return modsMatch(e, m) && isDigit(e, m.digit)
    case 'key':
      return modsMatch(e, m) && e.key === m.key
    case 'zoom': {
      // '+' exige ⇧ sur certaines dispositions : on ignore ⇧ pour le zoom.
      // Pas de repli positionnel (`e.code` Equal/Minus) : en AZERTY la touche « - » a
      // `code:'Equal'` et « ) » a `code:'Minus'`, ce qui déclencherait la mauvaise commande.
      if (!modsMatch(e, m, true)) return false
      return m.dir === 'in'
        ? e.key === '+' || e.key === '=' || e.code === 'NumpadAdd'
        : e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract'
    }
  }
}

export function matchesShortcut(e: KeyboardLike, def: Pick<ShortcutDef, 'match'>): boolean {
  return matchesKey(e, def.match)
}

/** Un champ éditable a le focus : les commandes d'édition restent natives. */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  if (t.isContentEditable) return true
  const tag = t.tagName
  if (tag === 'TEXTAREA') return true
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(type)
  }
  return false
}
