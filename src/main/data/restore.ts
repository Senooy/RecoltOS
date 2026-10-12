/**
 * Restauration d'un instantané :
 *  1. copie vers `tmp/restore-<ts>.db` puis `PRAGMA quick_check` sur la copie (abandon sinon) ;
 *  2. `closeForReplace()` : pause des jobs, arrêt des workers, checkpoint TRUNCATE, `-wal` vide
 *     exigé (sinon `wal_not_empty`, la bibliothèque reste ouverte et rien n'a bougé) ;
 *  3. `recolt.db` + `-wal` + `-shm` déplacés ENSEMBLE vers `snapshots/recolt-<ts>-pre-restore.db*` ;
 *  4. copie vérifiée renommée en `recolt.db`, tout `-wal` / `-shm` résiduel supprimé ;
 *  5. réouverture (migrations rejouées), FTS reconstruite, `verify` (médias manquants) ;
 *  6. le gestionnaire relance workers et file puis émet `library.switched` (même id).
 * En cas d'échec après le déplacement, l'ancienne base est remise en place puis rouverte.
 * Pas d'import electron : le gestionnaire est injecté.
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

/** `PRAGMA quick_check` sur un fichier (lecture seule). */
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
    // Remise en place de l'ancienne base avant toute réouverture.
    fs.rmSync(paths.db, { force: true })
    for (const [from, to] of moved.reverse()) {
      try {
        fs.renameSync(to, from)
      } catch {
        // dernier recours : l'instantané pre-restore reste disponible
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
    // La copie restaurée ne s'ouvre pas : retour à la base d'avant.
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
