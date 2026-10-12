/**
 * Ingestion of a list of paths (drag and drop, File › Import, "Open with"):
 * folders walked (`lstat` without following links, hidden files skipped,
 * depth ≤ 12, ≤ 20,000 files), confirmation beyond 200 files, files already in the
 * library skipped, progress `ingest.progress`, report `{added, duplicates, failed}`.
 */
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'
import type { IngestProgress, IngestReport } from '../../shared/dto/items'
import { AppError } from '../../shared/errors'
import { ingest, type IngestDeps } from './ingest'
import { mt } from '../i18n'

export const MAX_FILES = 20_000
export const MAX_DEPTH = 12
/** Beyond that, the user confirms ("Import 1,243 files?"). */
export const CONFIRM_ABOVE = 200

/** Extensions kept INSIDE a dropped folder (a single dropped file is always tried). */
export const MEDIA_EXT = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'avif',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
  'psd',
  'mp4',
  'mov',
  'm4v',
  'webm',
])

const extOf = (p: string): string => p.slice(p.lastIndexOf('.') + 1).toLowerCase()

export async function expand(paths: readonly string[], depth = MAX_DEPTH): Promise<string[]> {
  const out: string[] = []
  const walk = async (p: string, d: number, top: boolean) => {
    if (out.length >= MAX_FILES) return
    // Dropped roots: a link is followed if any; inside a folder, never.
    const st = await (top ? stat(p) : lstat(p)).catch(() => null)
    if (!st) {
      out.push(p) // reported as "not found" by the ingestion
      return
    }
    if (st.isFile()) {
      if (top || MEDIA_EXT.has(extOf(p))) out.push(p)
      return
    }
    if (!st.isDirectory() || d <= 0) return
    const names = (await readdir(p).catch(() => [] as string[]))
      .filter((n) => !n.startsWith('.'))
      .sort()
    for (const n of names) await walk(join(p, n), d - 1, false)
  }
  for (const p of paths) await walk(p, depth, true)
  return out
}

export async function ingestPaths(
  paths: readonly string[],
  opts: { collectionUuid?: string },
  deps: IngestDeps,
  onProgress?: (p: IngestProgress) => void,
  confirm?: (count: number) => Promise<boolean>,
): Promise<IngestReport> {
  const files = await expand(paths)
  if (confirm && files.length > CONFIRM_ABOVE && !(await confirm(files.length)))
    return { added: [], duplicates: [], failed: [] }
  const root = await realpath(deps.lib.root).catch(() => deps.lib.root)
  const report: IngestReport = { added: [], duplicates: [], failed: [] }
  let done = 0
  for (const path of files) {
    onProgress?.({ done, total: files.length, current: basename(path) })
    try {
      const real = await realpath(path).catch(() => path)
      if (real.startsWith(root + sep)) {
        // Already in the library (dragging from a card to the window): no re-import, no duplicate.
        done++
        continue
      }
      const r = await ingest({ type: 'file', path }, opts, deps)
      if (r.status === 'created') report.added.push({ itemUuid: r.itemUuid, path })
      else report.duplicates.push({ itemUuid: r.itemUuid, path })
    } catch (err) {
      const e = err instanceof AppError ? err : new AppError('io', mt().errors.importFailed)
      report.failed.push({ path, code: e.code, message: e.message })
      deps.log.warn(`[ingest] ${basename(path)}: ${e.code}`, err)
    }
    done++
  }
  onProgress?.({ done, total: files.length, current: null })
  return report
}
