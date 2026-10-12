/**
 * Clean close of a library: app exit, library switch,
 * restoring a snapshot, file replacement.
 *
 * 1. pause the job queue (wait ≤ 10 s for running jobs);
 * 2. stop the workers;
 * 3. `PRAGMA optimize`, then `PRAGMA wal_checkpoint(TRUNCATE)` (we check `busy = 0`);
 * 4. `db.close()`;
 * 5. `forReplace`: the `-wal` must be absent or empty, otherwise `AppError('wal_not_empty')`, the database
 *    is reopened (`reopen`) and the queue restarted: the calling operation is cancelled. If the
 *    reopening fails, the queue is not restarted and the `wal_not_empty` error is still thrown.
 * No `electron` import.
 */
import type Database from 'better-sqlite3'
import fs from 'node:fs'
import { AppError } from '../../shared/errors'
import { mt } from '../i18n'

export const JOBS_DRAIN_TIMEOUT_MS = 10_000
/** Maximum wait for readers during the final checkpoint. */
export const CHECKPOINT_BUSY_TIMEOUT_MS = 2_000

export interface CloseHooks {
  /** Pauses the queue and waits for `running` jobs (at most `timeoutMs`). */
  pauseJobs?(timeoutMs: number): void | Promise<void>
  /** Restarts the queue (after a `forReplace` failure). */
  resumeJobs?(): void | Promise<void>
  /** Stops the utility processes (they write files, never the database). */
  stopWorkers?(): void | Promise<void>
  /** Restarts the workers (after a `forReplace` failure). */
  startWorkers?(): void | Promise<void>
}

export interface ClosableLibrary {
  db: Database.Database
  /** Path of `recolt.db`. */
  dbFile: string
  hooks?: CloseHooks
  /** Reopens the database after a `forReplace` failure; the new connection replaces `db`. */
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
  /** `busy_timeout` applied during the final checkpoint (tests: a few ms). */
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
      lib.log?.warn('[db] final checkpoint failed', err)
    }
    if (checkpoint && checkpoint.busy !== 0) {
      lib.log?.warn('[db] checkpoint TRUNCATE blocked by a reader', checkpoint)
    }
    db.close()
  }

  if (opts.forReplace && walSize(lib.dbFile) > 0) {
    let reopened = true
    if (lib.reopen) {
      try {
        lib.db = lib.reopen()
      } catch (err) {
        // No database to serve: workers and queue stay stopped, the original error is rethrown.
        reopened = false
        lib.log?.warn('[db] could not reopen after wal_not_empty', err)
      }
    }
    if (reopened) {
      await hooks.startWorkers?.()
      await hooks.resumeJobs?.()
    }
    throw new AppError('wal_not_empty', mt().errors.dbInUse, checkpoint ?? undefined)
  }
  return { checkpoint }
}
