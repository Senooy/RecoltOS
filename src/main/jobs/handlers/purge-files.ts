/**
 * Job `purge.files` : inséré dans la MÊME transaction que le `DELETE FROM items`,
 * il supprime ensuite les fichiers (`rm`) ou les envoie dans la Corbeille macOS (`trash`, purge
 * automatique). Idempotent : un fichier déjà absent est ignoré.
 */
import { rm } from 'node:fs/promises'
import { moveToTrash } from '../../platform/trash'
import type { JobHandler } from './types'

export const purgeFiles: JobHandler = async (job, ctx) => {
  const files = Array.isArray(job.payload.files)
    ? job.payload.files.filter((f): f is string => typeof f === 'string')
    : []
  const mode = job.payload.mode === 'trash' ? 'trash' : 'rm'
  const abs: string[] = []
  for (const f of files) {
    try {
      abs.push(ctx.lib.paths.abs(f))
    } catch {
      ctx.log.warn(`[jobs] purge : chemin refusé ${f}`)
    }
  }
  if (mode === 'trash') {
    const report = await moveToTrash(abs, ctx.trashItem)
    if (report.failed.length > 0) {
      ctx.log.warn(
        `[jobs] purge : ${report.failed.length} fichier(s) non déplacé(s)`,
        report.failed,
      )
    }
  } else {
    for (const a of abs) await rm(a, { force: true })
  }
  return { status: 'done' }
}
