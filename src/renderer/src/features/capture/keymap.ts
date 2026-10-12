/**
 * Raccourci de capture depuis un `KeyboardEvent` : accélérateur **positionnel**
 * (construit depuis `e.code`, jamais `e.key`), libellé de la touche imprimée via `getLayoutMap()`.
 * Exemple AZERTY : la touche imprimée « A » est `KeyQ` → accélérateur `…+Q`, key cap « A ».
 */

export interface KeyEventLike {
  code: string
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const SPECIAL: Record<string, { accel: string; label: string }> = {
  Space: { accel: 'Space', label: '␣' },
  Tab: { accel: 'Tab', label: '⇥' },
  Backspace: { accel: 'Backspace', label: '⌫' },
  Delete: { accel: 'Delete', label: '⌦' },
  ArrowUp: { accel: 'Up', label: '↑' },
  ArrowDown: { accel: 'Down', label: '↓' },
  ArrowLeft: { accel: 'Left', label: '←' },
  ArrowRight: { accel: 'Right', label: '→' },
  Home: { accel: 'Home', label: '↖' },
  End: { accel: 'End', label: '↘' },
  PageUp: { accel: 'PageUp', label: '⇞' },
  PageDown: { accel: 'PageDown', label: '⇟' },
}

export function codeToAccelKey(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1]!
  m = /^(?:Digit|Numpad)([0-9])$/.exec(code)
  if (m) return m[1]!
  m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code)
  if (m) return code
  return SPECIAL[code]?.accel ?? null
}

const MODIFIER_CODES = new Set([
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'CapsLock',
  'Fn',
])

export type RecordResult =
  { accel: string; label: string } | { error: 'incomplete' | 'unsupported' }

export function eventToAccelerator(
  e: KeyEventLike,
  layout?: ReadonlyMap<string, string> | null,
): RecordResult {
  if (MODIFIER_CODES.has(e.code)) return { error: 'incomplete' }
  const key = codeToAccelKey(e.code)
  if (!key) return { error: 'unsupported' }
  const mods: string[] = []
  if (e.metaKey) mods.push('CommandOrControl')
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  const special = Object.values(SPECIAL).find((s) => s.accel === key)
  const printed = layout?.get(e.code)
  const label = special
    ? special.label
    : printed && printed.length === 1
      ? printed.toUpperCase()
      : key
  return { accel: [...mods, key].join('+'), label }
}

/** Key caps affichés (⌘ ⇧ S). */
export function accelToCaps(accel: string, label: string): string[] {
  const parts = accel.split('+')
  const mods = parts.slice(0, -1)
  const caps: string[] = []
  if (mods.some((m) => /^(CommandOrControl|CmdOrCtrl|Command|Cmd|Meta|Super)$/.test(m)))
    caps.push('⌘')
  if (mods.some((m) => /^(Control|Ctrl)$/.test(m))) caps.push('⌃')
  if (mods.some((m) => /^(Alt|Option|AltGr)$/.test(m))) caps.push('⌥')
  if (mods.includes('Shift')) caps.push('⇧')
  caps.push(label || (parts.at(-1) ?? ''))
  return caps
}

/** Code physique d'une touche d'accélérateur (« Q » → `KeyQ`), pour recalculer le libellé. */
export function accelKeyToCode(key: string): string | null {
  if (/^[A-Z]$/.test(key)) return `Key${key}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  return null
}
