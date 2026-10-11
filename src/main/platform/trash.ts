/**
 * Envoi de fichiers dans la Corbeille macOS (`shell.trashItem`, ARCHI §7) : purge automatique,
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
  failed: { path: string; message: string }[]
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
    } catch {
      report.missing.push(p)
      continue
    }
    try {
      await trashItem(p)
      report.trashed.push(p)
    } catch (err) {
      report.failed.push({ path: p, message: err instanceof Error ? err.message : String(err) })
    }
  }
  return report
}
