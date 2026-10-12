/**
 * `data.verify` : médias dont l'original a disparu (→ `missing` si `fix`), fichiers de
 * `items/` sans ligne en base (signalés, jamais supprimés), miniatures manquantes (→ job
 * `media.derive` si `fix`). Pas d'import electron.
 */
import fs from 'node:fs'
import path from 'node:path'
import { JOB_PRIORITY } from '../../shared/jobs'
import type { LibraryContext } from '../library/library-context'
import { mt } from '../i18n'

export interface VerifyIssue {
  code: 'missing_original' | 'orphan_file' | 'missing_thumb'
  message: string
  count: number
}

type Lib = Pick<LibraryContext, 'db' | 'paths' | 'repos'>

function walkFiles(dir: string, base: string, out: Set<string>): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(abs, base, out)
    else if (e.isFile()) out.add(path.relative(base, abs).split(path.sep).join('/'))
  }
}

export function verifyLibrary(
  lib: Lib,
  opts: { fix: boolean } = { fix: false },
): { ok: boolean; issues: VerifyIssue[] } {
  const rows = lib.db
    .prepare(
      `SELECT id, item_id, status, file_rel, thumb_rel, legacy_thumb_rel FROM item_media
       WHERE file_rel IS NOT NULL`,
    )
    .all() as {
    id: number
    item_id: number
    status: string
    file_rel: string
    thumb_rel: string | null
    legacy_thumb_rel: string | null
  }[]
  const exists = (rel: string) => {
    try {
      return fs.statSync(lib.paths.abs(rel)).isFile()
    } catch {
      return false
    }
  }
  let missing = 0
  let missingThumb = 0
  const known = new Set<string>()
  for (const r of rows) {
    known.add(r.file_rel)
    if (!exists(r.file_rel)) {
      if (r.status !== 'missing') {
        missing++
        if (opts.fix) lib.repos.media.setStatus(r.id, 'missing')
      }
      continue
    }
    if (r.status === 'ok' && r.thumb_rel && !exists(r.thumb_rel) && !r.legacy_thumb_rel) {
      missingThumb++
      if (opts.fix) {
        lib.repos.jobs.enqueue({
          type: 'media.derive',
          itemId: r.item_id,
          dedupeKey: `media:${r.id}`,
          payload: { mediaId: r.id },
          priority: JOB_PRIORITY.BACKGROUND,
        })
      }
    }
  }
  const files = new Set<string>()
  walkFiles(lib.paths.dir('items'), lib.paths.root, files)
  const orphans = [...files].filter((f) => !known.has(f)).length

  const issues: VerifyIssue[] = []
  if (missing > 0)
    issues.push({ code: 'missing_original', message: mt().verify.missingOriginals, count: missing })
  if (orphans > 0)
    issues.push({ code: 'orphan_file', message: mt().verify.orphanFiles, count: orphans })
  if (missingThumb > 0)
    issues.push({ code: 'missing_thumb', message: mt().verify.missingThumbs, count: missingThumb })
  return { ok: issues.length === 0, issues }
}
