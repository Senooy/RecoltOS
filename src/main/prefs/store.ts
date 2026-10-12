/**
 * `prefs.json` store: lenient read (`parsePrefsLenient`, field-by-field repair),
 * validated deep patch (`mergePrefs`), atomic write, notification
 * `prefs.changed`. No `electron` import (the native theme is followed by `prefs/init.ts`).
 */
import fs from 'node:fs'
import { AppError } from '../../shared/errors'
import {
  DEFAULT_PREFS,
  mergePrefs,
  parsePrefsLenient,
  type Prefs,
  type PrefsPatch,
} from '../../shared/prefs'
import { quarantine, writeJsonAtomic } from '../library/atomic-write'

export type PrefsListener = (next: Prefs, previous: Prefs) => void

export interface PrefsStoreDeps {
  file: string
  log?: { warn(...a: unknown[]): void; error(...a: unknown[]): void }
  now?: () => number
}

export type PrefsStore = ReturnType<typeof createPrefsStore>

export function createPrefsStore(deps: PrefsStoreDeps) {
  const listeners = new Set<PrefsListener>()

  /**
   * Reads the file. `repaired`: the file was absent, set aside or different from what was
   * read (repaired field); it must then be rewritten (`persist`), otherwise it stays damaged on disk.
   */
  const read = (): { prefs: Prefs; repaired: boolean } => {
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(deps.file, 'utf8'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        deps.log?.warn('[prefs] prefs.json unreadable, set aside', err)
        quarantine(deps.file, (deps.now ?? Date.now)())
      }
      return { prefs: DEFAULT_PREFS, repaired: true }
    }
    const prefs = parsePrefsLenient(raw)
    return { prefs, repaired: JSON.stringify(prefs) !== JSON.stringify(raw) }
  }

  const initial = read()
  let current: Prefs = initial.prefs

  return {
    /** True if `prefs.json` was created, set aside or repaired on opening: to be rewritten. */
    repairedAtOpen: initial.repaired,

    get(): Prefs {
      return current
    },

    /**
     * Applies a deep patch, revalidates everything (a `ZodError` leaves everything unchanged),
     * writes atomically then notifies. Returns the updated prefs.
     */
    set(patch: PrefsPatch): Prefs {
      const previous = current
      const next = mergePrefs(previous, patch)
      if (JSON.stringify(next) === JSON.stringify(previous)) return previous
      writeJsonAtomic(deps.file, next)
      current = next
      for (const l of listeners) {
        try {
          l(next, previous)
        } catch (err) {
          deps.log?.error('[prefs] listener failed', err)
        }
      }
      return next
    },

    /** Writes the current prefs (first run: file absent or repaired). */
    persist(): void {
      writeJsonAtomic(deps.file, current)
    },

    onChange(listener: PrefsListener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

let instance: PrefsStore | null = null

export function setPrefsStore(store: PrefsStore | null): void {
  instance = store
}

export function getPrefsStore(): PrefsStore | null {
  return instance
}

/** Store initialized by `initPrefs`, otherwise `AppError('internal')`. */
export function requirePrefsStore(): PrefsStore {
  if (!instance) throw new AppError('internal', 'Preferences not initialized.')
  return instance
}
