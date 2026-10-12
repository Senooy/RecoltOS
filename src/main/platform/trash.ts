/**
 * Sending files to the macOS Trash (`shell.trashItem`): automatic purge,
 * recoverable. Only an explicit "Empty Trash" does an `fs.rm` (elsewhere).
 * `trashItem` is injectable; by default, Electron's (loaded at call time).
 */
import { lstat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { mt } from '../i18n'

export type TrashItemFn = (abs: string) => Promise<void>

export interface TrashReport {
  trashed: string[]
  /** Already absent: nothing to do (idempotent purge). */
  missing: string[]
  /** `message` is in the interface language; `details` (raw Node message) is for the log only. */
  failed: { path: string; message: string; details?: string }[]
}

function rawMessage(err: unknown): string {
  const e = err as NodeJS.ErrnoException | undefined
  return e?.code ? `${e.code} : ${e.message}` : String(err)
}

const electronTrashItem: TrashItemFn = async (abs) => {
  const electron = await import('electron')
  await electron.shell.trashItem(abs)
}

export async function moveToTrash(
  paths: readonly string[],
  trashItem: TrashItemFn = electronTrashItem,
): Promise<TrashReport> {
  const report: TrashReport = { trashed: [], missing: [], failed: [] }
  for (const p of paths) {
    if (typeof p !== 'string' || !isAbsolute(p) || p.includes('\0')) {
      report.failed.push({ path: String(p), message: mt().errors.trashAbsolutePath })
      continue
    }
    try {
      await lstat(p)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        report.missing.push(p)
      } else {
        // EACCES, EPERM, EIO…: the file may still exist, it is not "already absent".
        const denied = code === 'EACCES' || code === 'EPERM'
        report.failed.push({
          path: p,
          message: denied ? mt().errors.accessDenied(p) : mt().errors.trashCheckFailed(p),
          details: rawMessage(err),
        })
      }
      continue
    }
    try {
      await trashItem(p)
      report.trashed.push(p)
    } catch (err) {
      report.failed.push({
        path: p,
        message: mt().errors.trashMoveFailed,
        details: rawMessage(err),
      })
    }
  }
  return report
}
