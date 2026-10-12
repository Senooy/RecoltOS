/**
 * Handlers `ingest.*` : `files` (glisser-déposer, menu Importer), sélecteurs de
 * fichiers et de dossier (confirmation au-delà de 200 fichiers), URL, presse-papiers (⌘V).
 */
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import type { IngestReport } from '../../../shared/dto/items'
import { readClipboardFiles, readClipboardImage, readClipboardUrl } from '../../import-ux/clipboard'
import { ingestPaths } from '../../ingest/files'
import { ingest } from '../../ingest/ingest'
import { emitIngestProgress, getPageCapture, requireJobServices } from '../../jobs/runtime'
import type { DomainHandlers, HandlerContext } from '../router'
import type { IngestDeps } from '../../ingest/ingest'

/** Services d'ingestion de la bibliothèque active (+ capture de page hors écran). */
export function ingestDeps(): IngestDeps {
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

/** « Importer 1 243 fichiers ? » au-delà de 200 fichiers. */
function confirmer(ctx?: HandlerContext) {
  return async (count: number): Promise<boolean> => {
    const options = {
      type: 'question' as const,
      message: `Importer ${new Intl.NumberFormat('fr-FR').format(count)} fichiers ?`,
      detail: 'Les dossiers déposés sont parcourus jusqu’à 12 niveaux.',
      buttons: ['Importer', 'Annuler'],
      defaultId: 0,
      cancelId: 1,
    }
    const win = ctx?.sender ? BrowserWindow.fromWebContents(ctx.sender) : null
    const r = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return r.response === 0
  }
}

const run = (
  paths: string[],
  collectionUuid?: string,
  ctx?: HandlerContext,
): Promise<IngestReport> =>
  ingestPaths(
    paths,
    collectionUuid ? { collectionUuid } : {},
    ingestDeps(),
    emitIngestProgress,
    ctx ? confirmer(ctx) : undefined,
  )

const single = async (
  input: Parameters<typeof ingest>[0],
  collectionUuid: string | undefined,
  label: string,
): Promise<IngestReport> => {
  const report: IngestReport = { added: [], duplicates: [], failed: [] }
  try {
    const r = await ingest(input, collectionUuid ? { collectionUuid } : {}, ingestDeps())
    if (r.status === 'created' || r.status === 'restored')
      report.added.push({ itemUuid: r.itemUuid })
    else report.duplicates.push({ itemUuid: r.itemUuid })
  } catch (err) {
    const e = err as { code?: string; message?: string }
    report.failed.push({
      path: label,
      code: e.code ?? 'io',
      message: e.message ?? 'Import impossible.',
    })
  }
  return report
}

export const ingestHandlers: DomainHandlers<'ingest'> = {
  'ingest.files': ({ paths, collectionUuid }, ctx) =>
    run(paths, collectionUuid, process.env.RECOLTOS_E2E === '1' ? undefined : ctx),
  'ingest.pickFiles': async (input, ctx) => {
    const paths = await pick(ctx, false)
    return paths ? run(paths, input.collectionUuid, ctx) : null
  },
  'ingest.pickFolder': async (input, ctx) => {
    const paths = await pick(ctx, true)
    return paths ? run(paths, input.collectionUuid, ctx) : null
  },
  'ingest.url': ({ url, collectionUuid }) => single({ type: 'url', url }, collectionUuid, url),
  /** ⌘V : fichiers du Finder, puis image, puis URL ; `null` si rien d'utilisable. */
  'ingest.clipboard': async ({ collectionUuid }, ctx) => {
    const files = await readClipboardFiles()
    if (files.length > 0) return run(files, collectionUuid, ctx)
    const png = await readClipboardImage()
    if (png)
      return single(
        { type: 'clipboard', image: png, mime: 'image/png' },
        collectionUuid,
        'presse-papiers',
      )
    const url = await readClipboardUrl()
    if (url) return single({ type: 'url', url }, collectionUuid, url)
    return null
  },
}
