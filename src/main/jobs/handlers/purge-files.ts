/**
 * Job `purge.files`: enqueued in the SAME transaction as the `DELETE FROM items`; it then
 * deletes the files (`rm`) or sends them to the macOS Trash (`trash`, automatic purge).
 * Idempotent: a file that is already gone is ignored.
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
      ctx.log.warn(`[jobs] purge: path refused ${f}`)
    }
  }
  if (mode === 'trash') {
    const report = await moveToTrash(abs, ctx.trashItem)
    if (report.failed.length > 0) {
      ctx.log.warn(`[jobs] purge: ${report.failed.length} file(s) not moved`, report.failed)
    }
  } else {
    for (const a of abs) await rm(a, { force: true })
  }
  return { status: 'done' }
}
