/**
 * Raccourcis de l'éditeur : table `SPACES_SHORTCUTS` (src/shared/shortcuts.ts).
 * Lettres = touche IMPRIMÉE (`getLayoutMap()`, insensible à ⌥/⇧ : ⌥A ne donne pas « å »),
 * chiffres = position (`e.code` Digit0/1/2, valable AZERTY et QWERTY), flèches = `e.key`.
 * La carte de disposition est injectable pour les tests (AZERTY / QWERTY simulés).
 *
 * Les commandes du menu natif (⌘Z, ⇧⌘Z, ⌘A, ⌘0, ⌘+, ⌘−) arrivent par `menu.command` ; ⌘C/⌘X/⌘V
 * par les événements DOM `copy` / `cut` / `paste` (rôles du menu Édition). Elles restent dans la
 * table pour l'affichage et le repli clavier.
 */
import {
  displayShortcutLabel,
  SPACES_SHORTCUTS,
  type KeyMatch,
  type Modifiers,
  type SpacesShortcutId,
} from '../../../../../shared/shortcuts'

export interface KeyLike {
  key: string
  code: string
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
}

export type Layout = ReadonlyMap<string, string> | null

let layout: Layout = null

/** `navigator.keyboard.getLayoutMap()` (relu au focus de la fenêtre). */
export async function initKeymap(): Promise<void> {
  const kb = (
    navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }
  ).keyboard
  if (!kb) return
  try {
    layout = await kb.getLayoutMap()
  } catch {
    layout = null
  }
}

export function setLayoutForTests(l: Layout): void {
  layout = l
}

/** Caractère imprimé (minuscule) de la touche, insensible à ⌥ et ⇧. */
export function baseChar(e: KeyLike, l: Layout = layout): string {
  // Sans ⌥ ni ⌃, `e.key` EST la touche imprimée (⌘ et ⇧ ne la transforment pas, hors casse).
  if (!e.altKey && !e.ctrlKey && /^\p{L}$/u.test(e.key)) return e.key.toLowerCase()
  const fromMap = l?.get(e.code)
  if (fromMap) return fromMap.toLowerCase()
  if ((e.altKey || e.ctrlKey) && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase()
  return e.key.length === 1 ? e.key.toLowerCase() : e.key
}

export const isDigit = (e: KeyLike, n: number) => e.code === `Digit${n}` || e.code === `Numpad${n}`

function mods(e: KeyLike, m: Modifiers, ignoreShift = false): boolean {
  return (
    e.metaKey === Boolean(m.meta) &&
    e.altKey === Boolean(m.alt) &&
    e.ctrlKey === Boolean(m.ctrl) &&
    (ignoreShift || e.shiftKey === Boolean(m.shift))
  )
}

export function matches(e: KeyLike, m: KeyMatch & Modifiers, l: Layout = layout): boolean {
  switch (m.kind) {
    case 'letter':
      return mods(e, m) && baseChar(e, l) === m.key
    case 'digit':
      return mods(e, m) && isDigit(e, m.digit)
    case 'key':
      return mods(e, m) && e.key === m.key
    case 'zoom':
      if (!mods(e, m, true)) return false
      return m.dir === 'in'
        ? e.key === '+' || e.key === '=' || e.code === 'NumpadAdd'
        : e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract'
  }
}

/** Action de l'éditeur pour cet événement, ou `null`. */
export function resolveShortcut(e: KeyLike, l: Layout = layout): SpacesShortcutId | null {
  for (const s of SPACES_SHORTCUTS) {
    if (matches(e, s.match, l)) return s.id
  }
  // Alias QWERTY non affichés de ⌥⌘↑/↓.
  if (e.metaKey && !e.altKey && !e.ctrlKey) {
    if (e.code === 'BracketRight') return e.shiftKey ? 'bringToFront' : 'bringForward'
    if (e.code === 'BracketLeft') return e.shiftKey ? 'sendToBack' : 'sendBackward'
  }
  return null
}

/** Libellé affiché d'un raccourci (lettre imprimée sur ce clavier). */
export function shortcutLabel(id: SpacesShortcutId): string {
  return displayShortcutLabel(SPACES_SHORTCUTS.find((s) => s.id === id)?.label ?? '')
}
