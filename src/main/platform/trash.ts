/**
 * Sending files to the macOS Trash (`shell.trashItem`): automatic purge,
 * recoverable. Only an explicit « Vider la corbeille » does an `fs.rm` (elsewhere).
 * `trashItem` is injectable; by default, Electron's (loaded at call time).
 */
import { lstat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

export type TrashItemFn = (abs: string) => Promise<void>

export interface TrashReport {
  trashed: string[]
  /** Already absent: nothing to do (idempotent purge). */
  missing: string[]
  /** `message` is in French; `details` (raw Node message) is for the log only. */
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
      report.failed.push({ path: String(p), message: 'chemin absolu attendu' })
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
          message: denied ? `accès refusé : ${p}` : `impossible de vérifier : ${p}`,
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
        message: 'impossible de déplacer dans la corbeille',
        details: rawMessage(err),
      })
    }
  }
  return report
}
