/**
 * Handlers `ingest.*` (WP-10) : `files` (glisser-déposer, menu Importer), sélecteurs de fichiers et
 * de dossier, URL. `clipboard` arrive avec WP-34 (M3).
 */
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import type { IngestReport } from '../../../shared/dto/items'
import { ingestPaths } from '../../ingest/files'
import { ingest } from '../../ingest/ingest'
import { emitIngestProgress, getPageCapture, requireJobServices } from '../../jobs/runtime'
import { notImplemented, type DomainHandlers, type HandlerContext } from '../router'
import type { IngestDeps } from '../../ingest/ingest'

function deps(): IngestDeps {
  const capture = getPageCapture()
  return capture ? { ...requireJobServices(), captureUrl: capture } : requireJobServices()
}

async function pick(ctx: HandlerContext, folder: boolean): Promise<string[] | null> {
  const options: OpenDialogOptions = {
    title: folder ? 'Importer un dossier' : 'Importer des fichiers',
    buttonLabel: 'Importer',
    properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'],
  }
  const win = ctx.sender ? BrowserWindow.fromWebContents(ctx.sender) : null
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths
}

const run = (paths: string[], collectionUuid?: string): Promise<IngestReport> =>
  ingestPaths(paths, collectionUuid ? { collectionUuid } : {}, deps(), emitIngestProgress)

export const ingestHandlers: DomainHandlers<'ingest'> = {
  ...notImplemented('ingest'),
  'ingest.files': ({ paths, collectionUuid }) => run(paths, collectionUuid),
  'ingest.pickFiles': async (input, ctx) => {
    const paths = await pick(ctx, false)
    return paths ? run(paths, input.collectionUuid) : null
  },
  'ingest.pickFolder': async (input, ctx) => {
    const paths = await pick(ctx, true)
    return paths ? run(paths, input.collectionUuid) : null
  },
  'ingest.url': async ({ url, collectionUuid }) => {
    const report: IngestReport = { added: [], duplicates: [], failed: [] }
    try {
      const r = await ingest({ type: 'url', url }, collectionUuid ? { collectionUuid } : {}, deps())
      if (r.status === 'created') report.added.push({ itemUuid: r.itemUuid })
      else report.duplicates.push({ itemUuid: r.itemUuid })
    } catch (err) {
      const e = err as { code?: string; message?: string }
      report.failed.push({
        path: url,
        code: e.code ?? 'io',
        message: e.message ?? 'Import impossible.',
      })
    }
    return report
  },
}
