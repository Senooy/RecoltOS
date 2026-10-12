/**
 * Electron accelerator entered by the user (global capture shortcut).
 * Form: at least one modifier, then a key: `CommandOrControl+Shift+S`.
 * Blocklist: system or application shortcuts (⌘Q, ⌘W, ⌘H, ⌘M, ⌘Tab, ⌘Space…)
 * cannot be hijacked. Zod only: importable by main, preload and renderer.
 */
import { z } from 'zod'
import { pick } from './i18n/lang'
import './zod-locale'

const COMMAND_MODIFIERS = ['CommandOrControl', 'CmdOrCtrl', 'Command', 'Cmd', 'Super', 'Meta']
const MODIFIERS = [
  ...COMMAND_MODIFIERS,
  'Control',
  'Ctrl',
  'Alt',
  'Option',
  'AltGr',
  'Shift',
] as const

const KEY_RE =
  /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right)$/

/** Keys that, with a command modifier, belong to the system or the application. */
const RESERVED_WITH_COMMAND = new Set(['Q', 'W', 'H', 'M', 'Tab', 'Space', 'Delete', 'Backspace'])

function parseAccel(accel: string): { mods: string[]; key: string } | null {
  const parts = accel.split('+')
  if (parts.length < 2) return null
  const key = parts[parts.length - 1] ?? ''
  const mods = parts.slice(0, -1)
  if (!KEY_RE.test(key)) return null
  if (!mods.every((m) => (MODIFIERS as readonly string[]).includes(m))) return null
  if (new Set(mods).size !== mods.length) return null
  return { mods, key }
}

export const Accelerator = z
  .string()
  .max(64)
  .refine((s) => parseAccel(s) !== null, {
    error: () =>
      pick({
        fr: 'raccourci attendu : au moins un modificateur puis une touche, ex. CommandOrControl+Shift+S',
        en: 'expected shortcut: at least one modifier then a key, e.g. CommandOrControl+Shift+S',
      }),
  })
  .refine(
    (s) => {
      const parsed = parseAccel(s)
      if (!parsed) return true
      const withCommand = parsed.mods.some((m) => COMMAND_MODIFIERS.includes(m))
      return !(withCommand && RESERVED_WITH_COMMAND.has(parsed.key))
    },
    {
      error: () =>
        pick({
          fr: 'raccourci réservé par le système ou l’application',
          en: 'shortcut reserved by the system or the app',
        }),
    },
  )
export type Accelerator = z.output<typeof Accelerator>
