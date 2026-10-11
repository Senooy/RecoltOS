/**
 * Fermeture propre d'une bibliothèque (ARCHI §4.6) : sortie de l'app, changement de bibliothèque,
 * restauration d'un snapshot, remplacement de fichier.
 *
 * 1. pause de la file de jobs (attente ≤ 10 s des jobs en cours, hook de WP-10) ;
 * 2. arrêt des workers (hook de WP-03) ;
 * 3. `PRAGMA optimize` puis `PRAGMA wal_checkpoint(TRUNCATE)` (on vérifie `busy = 0`) ;
 * 4. `db.close()` ;
 * 5. `forReplace` : le `-wal` doit être absent ou vide, sinon `AppError('wal_not_empty')`, la base
 *    est rouverte (`reopen`) et la file relancée : l'opération appelante est annulée. Si la
 *    réouverture échoue, la file n'est pas relancée et l'erreur `wal_not_empty` est tout de même levée.
 * Pas d'import `electron`.
 */
import type Database from 'better-sqlite3'
import fs from 'node:fs'
import { AppError } from '../../shared/errors'

export const JOBS_DRAIN_TIMEOUT_MS = 10_000
/** Attente maximale des lecteurs pendant le checkpoint final. */
export const CHECKPOINT_BUSY_TIMEOUT_MS = 2_000

export interface CloseHooks {
  /** Met la file en pause et attend les jobs `running` (au plus `timeoutMs`). */
  pauseJobs?(timeoutMs: number): void | Promise<void>
  /** Relance la file (après un échec `forReplace`). */
  resumeJobs?(): void | Promise<void>
  /** Arrête les utility processes (ils écrivent des fichiers, jamais la base). */
  stopWorkers?(): void | Promise<void>
  /** Redémarre les workers (après un échec `forReplace`). */
  startWorkers?(): void | Promise<void>
}

export interface ClosableLibrary {
  db: Database.Database
  /** Chemin de `recolt.db`. */
  dbFile: string
  hooks?: CloseHooks
  /** Rouvre la base après un échec `forReplace` ; la nouvelle connexion remplace `db`. */
  reopen?(): Database.Database
  log?: { warn(...args: unknown[]): void }
}

export interface CheckpointResult {
  busy: number
  log: number
  checkpointed: number
}

export interface CloseOptions {
  forReplace: boolean
  /** `busy_timeout` appliqué pendant le checkpoint final (tests : quelques ms). */
  checkpointBusyTimeoutMs?: number
  jobsDrainTimeoutMs?: number
}

export interface CloseResult {
  checkpoint: CheckpointResult | null
}

export function walFile(dbFile: string): string {
  return `${dbFile}-wal`
}

function walSize(dbFile: string): number {
  try {
    return fs.statSync(walFile(dbFile)).size
  } catch {
    return 0
  }
}

/** `PRAGMA wal_checkpoint(TRUNCATE)` → `{ busy, log, checkpointed }`. */
export function checkpointTruncate(db: Database.Database): CheckpointResult {
  const rows = db.pragma('wal_checkpoint(TRUNCATE)') as CheckpointResult[]
  return rows[0] ?? { busy: 0, log: 0, checkpointed: 0 }
}

export async function closeLibrary(lib: ClosableLibrary, opts: CloseOptions): Promise<CloseResult> {
  const hooks = lib.hooks ?? {}
  await hooks.pauseJobs?.(opts.jobsDrainTimeoutMs ?? JOBS_DRAIN_TIMEOUT_MS)
  await hooks.stopWorkers?.()

  const db = lib.db
  let checkpoint: CheckpointResult | null = null
  if (db.open) {
    try {
      db.pragma('optimize')
      db.pragma(`busy_timeout = ${opts.checkpointBusyTimeoutMs ?? CHECKPOINT_BUSY_TIMEOUT_MS}`)
      checkpoint = checkpointTruncate(db)
    } catch (err) {
      lib.log?.warn('[db] checkpoint final impossible', err)
    }
    if (checkpoint && checkpoint.busy !== 0) {
      lib.log?.warn('[db] checkpoint TRUNCATE bloqué par un lecteur', checkpoint)
    }
    db.close()
  }

  if (opts.forReplace && walSize(lib.dbFile) > 0) {
    let reopened = true
    if (lib.reopen) {
      try {
        lib.db = lib.reopen()
      } catch (err) {
        // Pas de base à servir : workers et file restent arrêtés, l'erreur d'origine est relancée.
        reopened = false
        lib.log?.warn('[db] réouverture impossible après wal_not_empty', err)
      }
    }
    if (reopened) {
      await hooks.startWorkers?.()
      await hooks.resumeJobs?.()
    }
    throw new AppError(
      'wal_not_empty',
      'La base est encore utilisée par un autre lecteur : opération annulée.',
      checkpoint ?? undefined,
    )
  }
  return { checkpoint }
}
