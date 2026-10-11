/**
 * Bibliothèque active (ARCHI §2.1) : `{ id, root, paths, db, repos }`, et points d'accroche du
 * cycle de vie pour les autres domaines (WP-03 workers, WP-05 protocole, WP-10 file de jobs).
 * Une seule bibliothèque est ouverte à la fois. Pas d'import `electron`.
 */
import type Database from 'better-sqlite3'
import { AppError } from '../../shared/errors'
import type { CloseHooks } from '../db/close'
import type { Repos } from '../db/repos'
import type { LibraryPaths } from './paths'

export interface LibraryContext {
  id: string
  name: string
  root: string
  paths: LibraryPaths
  db: Database.Database
  repos: Repos
}

/**
 * Accroches de cycle de vie, enregistrées par les domaines dans leur `init.ts` :
 * - `afterOpen` : la bibliothèque vient d'être ouverte (démarrage, bascule, restauration) ;
 * - `pauseJobs` / `stopWorkers` : appelés par `closeLibrary` AVANT le checkpoint ;
 * - `startWorkers` / `resumeJobs` : relance après un `closeLibrary({forReplace})` annulé, ET après
 *   chaque bascule, repli ou `reopen()` réussi (le gestionnaire les appelle APRÈS `afterOpen`, dans
 *   l'ordre inverse d'enregistrement). Au démarrage (`open()`), seul `afterOpen` est appelé : il
 *   démarre les workers et la file. Les trois doivent donc être idempotents.
 */
export interface LibraryLifecycle extends CloseHooks {
  afterOpen?(ctx: LibraryContext): void | Promise<void>
}

let active: LibraryContext | null = null
const lifecycles = new Map<string, LibraryLifecycle>()

export function getActiveLibrary(): LibraryContext | null {
  return active
}

/** Bibliothèque active ou `AppError('library_unavailable')`. */
export function requireLibrary(): LibraryContext {
  if (!active) throw new AppError('library_unavailable', 'Aucune bibliothèque ouverte.')
  return active
}

export function setActiveLibrary(ctx: LibraryContext | null): void {
  active = ctx
}

/** Enregistre (ou remplace) les accroches d'un domaine ; renvoie la fonction de retrait. */
export function registerLibraryLifecycle(domain: string, lc: LibraryLifecycle): () => void {
  lifecycles.set(domain, lc)
  return () => {
    if (lifecycles.get(domain) === lc) lifecycles.delete(domain)
  }
}

/** Accroches agrégées, dans l'ordre d'enregistrement (relance : ordre inverse). */
export function aggregatedCloseHooks(): Required<CloseHooks> {
  const all = () => [...lifecycles.values()]
  return {
    async pauseJobs(ms) {
      for (const lc of all()) await lc.pauseJobs?.(ms)
    },
    async stopWorkers() {
      for (const lc of all()) await lc.stopWorkers?.()
    },
    async startWorkers() {
      for (const lc of all().reverse()) await lc.startWorkers?.()
    },
    async resumeJobs() {
      for (const lc of all().reverse()) await lc.resumeJobs?.()
    },
  }
}

export async function runAfterOpen(ctx: LibraryContext): Promise<void> {
  for (const lc of lifecycles.values()) await lc.afterOpen?.(ctx)
}

/** Tests uniquement. */
export function resetLibraryContextForTests(): void {
  active = null
  lifecycles.clear()
}
