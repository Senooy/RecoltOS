/**
 * Snapshot restore:
 *  1. copy to `tmp/restore-<ts>.db` then `PRAGMA quick_check` on the copy (abort otherwise);
 *  2. `closeForReplace()`: pause jobs, stop workers, TRUNCATE checkpoint, empty `-wal` required
 *     (otherwise `wal_not_empty`, the library stays open and nothing has moved);
 *  3. `recolt.db` + `-wal` + `-shm` moved TOGETHER to `snapshots/recolt-<ts>-pre-restore.db*`;
 *  4. verified copy renamed to `recolt.db`, any residual `-wal` / `-shm` removed;
 *  5. reopen (migrations replayed), FTS rebuilt, `verify` (missing media);
 *  6. the manager restarts workers and queue, then emits `library.switched` (same id).
 * If it fails after the move, the old database is put back in place and reopened.
 * No electron import: the manager is injected.
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '../../shared/errors'
import { snapshotPath, snapshotStamp } from '../db/migrate'
import type { LibraryContext } from '../library/library-context'
import { snapshotFile } from './snapshots'
import { verifyLibrary } from './verify'
import { mt } from '../i18n'

export interface RestoreManager {
  active(): LibraryContext | null
  closeForReplace(): Promise<void>
  reopen(): Promise<LibraryContext>
}

export interface RestoreResult {
  preRestore: string
  issues: number
}

/** `PRAGMA quick_check` on a file (read-only). */
export function quickCheck(file: string): boolean {
  let db: Database.Database | null = null
  try {
    db = new Database(file, { readonly: true, fileMustExist: true })
    const rows = db.pragma('quick_check') as { quick_check: string }[]
    return rows.length === 1 && rows[0]!.quick_check === 'ok'
  } catch {
    return false
  } finally {
    db?.close()
  }
}

function moveIfExists(from: string, to: string): boolean {
  if (!fs.existsSync(from)) return false
  fs.renameSync(from, to)
  return true
}

export async function restoreSnapshot(
  manager: RestoreManager,
  name: string,
  now: () => number = Date.now,
): Promise<RestoreResult> {
  const lib = manager.active()
  if (!lib) throw new AppError('library_unavailable', mt().errors.noLibrary)
  const src = snapshotFile(lib, name)
  if (!fs.existsSync(src)) throw new AppError('not_found', mt().errors.snapshotNotFound)
  const paths = lib.paths
  const tmp = path.join(paths.dir('tmp'), `restore-${snapshotStamp(now())}-${process.pid}.db`)
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.copyFileSync(src, tmp)
  if (!quickCheck(tmp)) {
    fs.rmSync(tmp, { force: true })
    throw new AppError('validation', mt().errors.snapshotDamaged)
  }

  try {
    await manager.closeForReplace()
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }

  const pre = snapshotPath(paths.dir('snapshots'), 'pre-restore', now())
  const moved: [string, string][] = []
  try {
    for (const [from, to] of [
      [paths.db, pre],
      [paths.wal, `${pre}-wal`],
      [paths.shm, `${pre}-shm`],
    ] as const) {
      if (moveIfExists(from, to)) moved.push([from, to])
    }
    fs.renameSync(tmp, paths.db)
    fs.rmSync(paths.wal, { force: true })
    fs.rmSync(paths.shm, { force: true })
  } catch (err) {
    // Put the old database back in place before any reopening.
    fs.rmSync(paths.db, { force: true })
    for (const [from, to] of moved.reverse()) {
      try {
        fs.renameSync(to, from)
      } catch {
        // last resort: the pre-restore snapshot remains available
      }
    }
    await manager.reopen()
    throw new AppError('io', mt().errors.restoreFailed, {
      cause: String(err),
    })
  }

  let next: LibraryContext
  try {
    next = await manager.reopen()
  } catch (err) {
    // The restored copy does not open: back to the previous database.
    fs.rmSync(paths.db, { force: true })
    fs.rmSync(paths.wal, { force: true })
    fs.rmSync(paths.shm, { force: true })
    for (const [from, to] of moved.reverse()) fs.renameSync(to, from)
    await manager.reopen()
    throw err
  }
  next.repos.search.rebuild()
  const report = verifyLibrary(next, { fix: true })
  return {
    preRestore: path.basename(pre),
    issues: report.issues.reduce((n, i) => n + i.count, 0),
  }
}
