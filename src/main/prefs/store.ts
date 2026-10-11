/**
 * Magasin `prefs.json` (ARCHI §3.3, PLAN §4.5) : lecture tolérante (`parsePrefsLenient`, réparation
 * champ par champ), patch profond revalidé (`mergePrefs`), écriture atomique, notification
 * `prefs.changed`. Pas d'import `electron` (le thème natif est suivi par `prefs/init.ts`).
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
   * Lit le fichier. `repaired` : le fichier était absent, mis de côté ou différent de ce qui a été
   * lu (champ réparé) ; il doit alors être réécrit (`persist`), sinon il reste abîmé sur disque.
   */
  const read = (): { prefs: Prefs; repaired: boolean } => {
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(deps.file, 'utf8'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        deps.log?.warn('[prefs] prefs.json illisible, mis de côté', err)
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
    /** Vrai si `prefs.json` a été créé, mis de côté ou réparé à l'ouverture : à réécrire. */
    repairedAtOpen: initial.repaired,

    get(): Prefs {
      return current
    },

    /**
     * Applique un patch profond, revalide l'ensemble (une `ZodError` laisse tout inchangé),
     * écrit atomiquement puis notifie. Renvoie les prefs à jour.
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
          deps.log?.error('[prefs] écouteur en échec', err)
        }
      }
      return next
    },

    /** Écrit les prefs courantes (première exécution : fichier absent ou réparé). */
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

/** Magasin initialisé par `initPrefs`, sinon `AppError('internal')`. */
export function requirePrefsStore(): PrefsStore {
  if (!instance) throw new AppError('internal', 'Préférences non initialisées.')
  return instance
}
