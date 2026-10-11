/**
 * Ingestion d'une liste de chemins (glisser-déposer, Fichier › Importer) : dossiers parcourus
 * (fichiers cachés ignorés, profondeur 4), fichiers déjà dans la bibliothèque ignorés, progression
 * `ingest.progress`, rapport `{added, duplicates, failed}`.
 */
import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'
import type { IngestProgress, IngestReport } from '../../shared/dto/items'
import { AppError } from '../../shared/errors'
import { ingest, type IngestDeps } from './ingest'

export const MAX_FILES = 10_000

async function expand(paths: readonly string[], depth = 4): Promise<string[]> {
  const out: string[] = []
  const walk = async (p: string, d: number) => {
    if (out.length >= MAX_FILES) return
    const st = await stat(p).catch(() => null)
    if (!st) {
      out.push(p) // signalé « introuvable » par l'ingestion
      return
    }
    if (st.isFile()) {
      out.push(p)
      return
    }
    if (!st.isDirectory() || d <= 0) return
    const names = (await readdir(p).catch(() => [] as string[]))
      .filter((n) => !n.startsWith('.'))
      .sort()
    for (const n of names) await walk(join(p, n), d - 1)
  }
  for (const p of paths) await walk(p, depth)
  return out
}

export async function ingestPaths(
  paths: readonly string[],
  opts: { collectionUuid?: string },
  deps: IngestDeps,
  onProgress?: (p: IngestProgress) => void,
): Promise<IngestReport> {
  const files = await expand(paths)
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
