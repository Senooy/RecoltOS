/**
 * Ingestion d'une liste de chemins (glisser-déposer, Fichier › Importer, « Ouvrir avec ») :
 * dossiers parcourus (SPACES §3.1 : `lstat` sans suivre les liens, fichiers cachés ignorés,
 * profondeur ≤ 12, ≤ 20 000 fichiers), confirmation au-delà de 200 fichiers, fichiers déjà dans la
 * bibliothèque ignorés, progression `ingest.progress`, rapport `{added, duplicates, failed}`.
 */
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'
import type { IngestProgress, IngestReport } from '../../shared/dto/items'
import { AppError } from '../../shared/errors'
import { ingest, type IngestDeps } from './ingest'

export const MAX_FILES = 20_000
export const MAX_DEPTH = 12
/** Au-delà, l'utilisateur confirme (« Importer 1 243 fichiers ? »). */
export const CONFIRM_ABOVE = 200

/** Extensions retenues DANS un dossier déposé (un fichier déposé seul est toujours essayé). */
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
    // Racines déposées : on suit un lien éventuel ; à l'intérieur d'un dossier, jamais.
    const st = await (top ? stat(p) : lstat(p)).catch(() => null)
    if (!st) {
      out.push(p) // signalé « introuvable » par l'ingestion
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
        // Déjà dans la bibliothèque (glisser d'une carte vers la fenêtre) : ni réimport ni doublon.
        done++
        continue
      }
      const r = await ingest({ type: 'file', path }, opts, deps)
      if (r.status === 'created') report.added.push({ itemUuid: r.itemUuid, path })
      else report.duplicates.push({ itemUuid: r.itemUuid, path })
    } catch (err) {
      const e = err instanceof AppError ? err : new AppError('io', 'Import impossible.')
      report.failed.push({ path, code: e.code, message: e.message })
      deps.log.warn(`[ingest] ${basename(path)} : ${e.code}`, err)
    }
    done++
  }
  onProgress?.({ done, total: files.length, current: null })
  return report
}
