/**
 * Envoi de fichiers dans la Corbeille macOS (`shell.trashItem`) : purge automatique,
 * récupérable. Seul « Vider la corbeille » explicite fait un `fs.rm` (ailleurs).
 * `trashItem` est injectable ; par défaut, celui d'Electron (chargé à l'appel).
 */
import { lstat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

export type TrashItemFn = (abs: string) => Promise<void>

export interface TrashReport {
  trashed: string[]
  /** Déjà absents : rien à faire (purge idempotente). */
  missing: string[]
  /** `message` est en français ; `details` (message Node brut) sert au journal seulement. */
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
        // EACCES, EPERM, EIO… : le fichier existe peut-être, il n'est pas « déjà absent ».
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
