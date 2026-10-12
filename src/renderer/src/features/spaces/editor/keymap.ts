/**
 * Editor shortcuts: `SPACES_SHORTCUTS` table (src/shared/shortcuts.ts).
 * Letters = PRINTED key (`getLayoutMap()`, unaffected by ⌥/⇧: ⌥A does not give "å"),
 * digits = position (`e.code` Digit0/1/2, valid for AZERTY and QWERTY), arrows = `e.key`.
 * The layout map can be injected for tests (simulated AZERTY / QWERTY).
 *
 * Native menu commands (⌘Z, ⇧⌘Z, ⌘A, ⌘0, ⌘+, ⌘−) arrive via `menu.command`; ⌘C/⌘X/⌘V
 * via the DOM `copy` / `cut` / `paste` events (Edit menu roles). They stay in the
 * table for display and keyboard fallback.
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

/** `navigator.keyboard.getLayoutMap()` (re-read on window focus). */
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

/** Printed character (lowercase) of the key, unaffected by ⌥ and ⇧. */
export function baseChar(e: KeyLike, l: Layout = layout): string {
  // Without ⌥ or ⌃, `e.key` IS the printed key (⌘ and ⇧ do not change it, apart from case).
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

/** Editor action for this event, or `null`. */
export function resolveShortcut(e: KeyLike, l: Layout = layout): SpacesShortcutId | null {
  for (const s of SPACES_SHORTCUTS) {
    if (matches(e, s.match, l)) return s.id
  }
  // QWERTY aliases of ⌥⌘↑/↓, not displayed.
  if (e.metaKey && !e.altKey && !e.ctrlKey) {
    if (e.code === 'BracketRight') return e.shiftKey ? 'bringToFront' : 'bringForward'
    if (e.code === 'BracketLeft') return e.shiftKey ? 'sendToBack' : 'sendBackward'
  }
  return null
}

/** Displayed label of a shortcut (printed letter on this keyboard). */
export function shortcutLabel(id: SpacesShortcutId): string {
  return displayShortcutLabel(SPACES_SHORTCUTS.find((s) => s.id === id)?.label ?? '')
}
