/**
 * Handlers `data.*` : export zip (dialogue d'enregistrement, media-worker,
 * `export.progress`, affichage dans le Finder), instantanés (création, liste, suppression,
 * restauration), vérification, stockage, régénération des aperçus.
 */
import { app, dialog, shell, BrowserWindow } from 'electron'
import path from 'node:path'
import { AppError } from '../../../shared/errors'
import { JOB_PRIORITY } from '../../../shared/jobs'
import { exportZip, defaultExportName } from '../../data/export-zip'
import { restoreSnapshot } from '../../data/restore'
import { createSnapshot, deleteSnapshot, listSnapshots, applyRetention } from '../../data/snapshots'
import { storageBreakdown } from '../../data/storage'
import { verifyLibrary } from '../../data/verify'
import { emitEvent } from '../../events'
import { getJobQueue } from '../../jobs/runtime'
import { getLibraryManager } from '../../library/init'
import { requireLibrary } from '../../library/library-context'
import { getMediaWorker } from '../../protocol/media-worker'
import { getMainWindow } from '../../windows/main-window'
import type { DomainHandlers, HandlerContext } from '../router'
import { mt } from '../../i18n'

function windowOf(ctx: HandlerContext): BrowserWindow | null {
  return (ctx.sender ? BrowserWindow.fromWebContents(ctx.sender) : null) ?? getMainWindow()
}

let exporting = false

export const dataHandlers: DomainHandlers<'data'> = {
  'data.exportZip': async ({ includeDerived, collectionUuid }, ctx) => {
    const lib = requireLibrary()
    if (exporting) throw new AppError('conflict', mt().errors.exportBusy)
    let label = lib.name
    if (collectionUuid) {
      const c = lib.db
        .prepare('SELECT name FROM collections WHERE uuid = ?')
        .get(collectionUuid) as { name: string } | undefined
      if (!c) throw new AppError('not_found', mt().errors.collectionNotFound)
      label = c.name
    }
    const win = windowOf(ctx)
    const options = {
      defaultPath: path.join(app.getPath('downloads'), defaultExportName(label, Date.now())),
      buttonLabel: mt().dialogs.exportButton,
      filters: [{ name: mt().dialogs.zipArchive, extensions: ['zip'] }],
    }
    const res = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return { cancelled: true as const }
    const out = res.filePath.endsWith('.zip') ? res.filePath : `${res.filePath}.zip`
    const worker = getMediaWorker()
    if (!worker) throw new AppError('worker_unavailable', mt().errors.mediaWorkerUnavailable)
    exporting = true
    try {
      const r = await exportZip(
        lib,
        { includeDerived, collectionUuid },
        out,
        (args, onProgress) =>
          worker.call('zipLibrary', args, {
            onProgress: (p) => onProgress(p as { done: number; total: number }),
          }),
        (p) => emitEvent('export.progress', p),
      )
      shell.showItemInFolder(r.path)
      return { path: r.path }
    } finally {
      exporting = false
    }
  },

  'data.snapshot.create': ({ reason }) => {
    const lib = requireLibrary()
    const info = createSnapshot(lib, reason ?? 'manual', Date.now())
    applyRetention(lib, Date.now())
    return info
  },

  'data.snapshot.list': () => listSnapshots(requireLibrary()),

  'data.snapshot.restore': async ({ name }) => {
    const manager = getLibraryManager()
    if (!manager) throw new AppError('library_unavailable', mt().errors.noLibrary)
    await restoreSnapshot(manager, name)
  },

  'data.snapshot.delete': ({ name }) => {
    deleteSnapshot(requireLibrary(), name)
  },

  'data.verify': () => verifyLibrary(requireLibrary(), { fix: true }),

  'data.storage': async () => {
    const lib = requireLibrary()
    const sizes = await storageBreakdown(lib)
    const byType = lib.db
      .prepare(
        `SELECT media_type AS t, coalesce(sum(file_size), 0) AS n FROM item_media
         WHERE file_rel IS NOT NULL GROUP BY media_type`,
      )
      .all() as { t: string; n: number }[]
    const of = (t: string) => byType.find((r) => r.t === t)?.n ?? 0
    return { ...sizes, images: of('image'), videos: of('video') }
  },

  'data.regenerateDerived': () => {
    const lib = requireLibrary()
    const rows = lib.db
      .prepare(
        `SELECT m.id, m.item_id FROM item_media m JOIN items i ON i.id = m.item_id
         WHERE m.file_rel IS NOT NULL AND m.status IN ('ok', 'failed') AND i.deleted_at IS NULL`,
      )
      .all() as { id: number; item_id: number }[]
    lib.db.transaction(() => {
      for (const r of rows) {
        lib.repos.jobs.enqueue({
          type: 'media.derive',
          itemId: r.item_id,
          dedupeKey: `media:${r.id}`,
          payload: { mediaId: r.id },
          priority: JOB_PRIORITY.BACKGROUND,
        })
      }
    })()
    getJobQueue()?.kick()
    return { count: rows.length }
  },
}
