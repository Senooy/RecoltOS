/**
 * Raccourci global de capture (SPACES §2.2) : validation (≥ 1 modificateur parmi ⌘/⌃/⌥ + une
 * touche, refus des raccourcis système), enregistrement IMMÉDIAT avec retour à l'ancien si
 * `register` échoue (`taken`), verrou `inFlight` géré par le service et anti-rebond de 400 ms.
 * `globalShortcut` est injecté (tests).
 */
import { Accelerator } from '../../shared/accelerator'

export type ShortcutError = 'invalid' | 'reserved' | 'taken'
export type ShortcutResult = { ok: true } | { ok: false; error: ShortcutError }

export interface GlobalShortcutLike {
  register(accel: string, cb: () => void): boolean
  unregister(accel: string): void
  isRegistered?(accel: string): boolean
}

const COMMAND = ['CommandOrControl', 'CmdOrCtrl', 'Command', 'Cmd', 'Super', 'Meta']
const TRIGGER_MODS = [...COMMAND, 'Control', 'Ctrl', 'Alt', 'Option', 'AltGr']

/** Réservés par macOS (captures natives ⇧⌘3/4/5/6). */
const MAC_RESERVED = new Set(['3', '4', '5', '6'])

export function validateAccelerator(accel: string): 'ok' | 'invalid' | 'reserved' {
  const parts = accel.split('+')
  const key = parts.at(-1) ?? ''
  const mods = parts.slice(0, -1)
  if (!mods.some((m) => TRIGGER_MODS.includes(m))) return 'invalid'
  const r = Accelerator.safeParse(accel)
  if (!r.success) {
    return r.error.issues.some((i) => /réservé/.test(i.message)) ? 'reserved' : 'invalid'
  }
  const cmd = mods.some((m) => COMMAND.includes(m))
  if (cmd && mods.includes('Shift') && MAC_RESERVED.has(key)) return 'reserved'
  return 'ok'
}

export const DEBOUNCE_MS = 400

export function createShortcutManager(gs: GlobalShortcutLike, now: () => number = Date.now) {
  let current: string | null = null
  let last = 0
  let handler: () => void = () => undefined
  const fire = () => {
    const t = now()
    if (t - last < DEBOUNCE_MS) return
    last = t
    handler()
  }
  return {
    get current() {
      return current
    },
    /** Remplace le raccourci ; en cas d'échec, l'ancien reste actif. */
    set(next: string, onTrigger: () => void): ShortcutResult {
      const v = validateAccelerator(next)
      if (v !== 'ok') return { ok: false, error: v }
      handler = onTrigger
      if (next === current) return { ok: true }
      const prev = current
      if (prev) gs.unregister(prev)
      let ok = false
      try {
        ok = gs.register(next, fire)
      } catch {
        ok = false
      }
      if (!ok) {
        if (prev) {
          try {
            gs.register(prev, fire)
          } catch {
            // l'ancien ne peut plus être rétabli : rien d'actif
          }
        }
        return { ok: false, error: 'taken' }
      }
      current = next
      return { ok: true }
    },
    dispose() {
      if (current) gs.unregister(current)
      current = null
    },
  }
}

/** Touche de l'accélérateur (« S » pour `CommandOrControl+Shift+S`). */
export const acceleratorKey = (accel: string): string => accel.split('+').at(-1) ?? ''

/**
 * Accélérateur du menu « Capturer l'écran » : posé seulement si le libellé de la disposition
 * active est la même touche (sinon le menu s'attacherait à une autre touche que le raccourci).
 */
export function menuAccelerator(accel: string, label: string): string | undefined {
  return label.toUpperCase() === acceleratorKey(accel).toUpperCase() ? accel : undefined
}
