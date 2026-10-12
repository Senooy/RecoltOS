/**
 * Handlers `system.*` :
 * revealInFinder, openExternal (http(s) seulement), copyImage (`toPng` du media-worker →
 * `clipboard.write([ClipboardItem image/png])`, poster pour une vidéo), copyText, saveAs, quickLook
 * (`previewFile`), edit (`webContents.<cmd>()`), openLogs, redetectTools, appInfo.
 * L'original est toujours donné tel quel (jamais un dérivé), sauf pour la copie d'image.
 */
import {
  BrowserWindow,
  ClipboardItem,
  app,
  clipboard,
  dialog,
  nativeImage,
  shell,
  type WebContents,
} from 'electron'
import log from 'electron-log/main'
import { takePendingNav } from '../../nav'
import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '../../../shared/errors'
import { requireLibrary } from '../../library/library-context'
import { mediaToolsOf, resolveBinaries, toolsPrefsPatch } from '../../platform/binaries'
import { requirePrefsStore } from '../../prefs/store'
import { copyImageSource, loadItem, requireCoverOriginal } from '../../protocol/item-files'
import { getMediaWorker, localMediaWorker } from '../../protocol/media-worker'
import { getMainWindow } from '../../windows/main-window'
import type { DomainHandlers, HandlerContext } from '../router'
import { mt } from '../../i18n'

/** Côté le plus long de l'image copiée (un original de 50 Mpx donnerait un PNG énorme). */
export const COPY_IMAGE_MAX_EDGE = 4096
export const COPY_IMAGE_TIMEOUT_MS = 30_000

function windowOf(ctx: HandlerContext): BrowserWindow | null {
  const fromSender = ctx.sender ? BrowserWindow.fromWebContents(ctx.sender) : null
  return fromSender ?? getMainWindow()
}

function webContentsOf(ctx: HandlerContext): WebContents {
  const wc = ctx.sender ?? getMainWindow()?.webContents
  if (!wc || wc.isDestroyed()) throw new AppError('not_found', mt().errors.noActiveWindow)
  return wc
}

/** Nom proposé par « Enregistrer sous » : titre nettoyé + extension de l'original. */
export function suggestedFileName(title: string | null | undefined, original: string): string {
  const ext = path.extname(original)
  const base = (title ?? '')
    .normalize('NFC')
    // Ni séparateur, ni caractère de contrôle, ni « : » (affiché « / » par le Finder).
    .replace(/[/\\:\p{Cc}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim()
  return base ? `${base}${ext}` : path.basename(original)
}

export const systemHandlers: DomainHandlers<'system'> = {
  'system.revealInFinder': ({ itemUuid }) => {
    shell.showItemInFolder(requireCoverOriginal(requireLibrary(), itemUuid))
  },

  'system.openExternal': async ({ url }) => {
    // Le contrat (`WebUrl`) l'impose déjà ; défense en profondeur avant de passer la main à macOS.
    const protocol = new URL(url).protocol
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new AppError('validation', mt().errors.httpOnly)
    }
    await shell.openExternal(url)
  },

  'system.copyImage': async ({ itemUuid }) => {
    const src = copyImageSource(requireLibrary(), itemUuid)
    const mw = getMediaWorker()
    if (!mw) throw new AppError('system.worker_unavailable', mt().errors.imageWorkerUnavailable)
    const { png } = await mw.call(
      'toPng',
      { abs: src, maxEdge: COPY_IMAGE_MAX_EDGE },
      { timeoutMs: COPY_IMAGE_TIMEOUT_MS },
    )
    const bytes = Buffer.from(png)
    // Electron 44 : `clipboard.writeImage` n'existe plus ; `write([ClipboardItem])` (W3C).
    // `nativeImage` sert seulement à vérifier que le PNG du worker est décodable et non vide.
    if (nativeImage.createFromBuffer(bytes).isEmpty()) {
      throw new AppError('system.decode_failed', mt().errors.copyImageFailed)
    }
    await clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) }),
    ])
  },

  'system.copyText': async ({ text }) => {
    await clipboard.writeText(text)
  },

  'system.saveAs': async ({ itemUuid }, ctx) => {
    const lib = requireLibrary()
    const src = requireCoverOriginal(lib, itemUuid)
    const { item } = loadItem(lib, itemUuid)
    const defaultPath = path.join(
      app.getPath('downloads'),
      suggestedFileName(item.title ?? item.ai_title, src),
    )
    const win = windowOf(ctx)
    const options = { defaultPath, buttonLabel: mt().dialogs.save }
    const res = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return null
    if (path.resolve(res.filePath) === path.resolve(src)) return { path: res.filePath }
    try {
      await fs.promises.copyFile(src, res.filePath)
    } catch (err) {
      throw new AppError('io', mt().errors.saveFileFailed, {
        code: (err as NodeJS.ErrnoException).code,
      })
    }
    return { path: res.filePath }
  },

  'system.quickLook': ({ itemUuid }, ctx) => {
    const lib = requireLibrary()
    const abs = requireCoverOriginal(lib, itemUuid)
    const win = windowOf(ctx)
    if (!win) throw new AppError('not_found', mt().errors.noActiveWindow)
    const { item } = loadItem(lib, itemUuid)
    win.previewFile(abs, item.title || path.basename(abs))
  },

  'system.edit': ({ cmd }, ctx) => {
    const wc = webContentsOf(ctx)
    switch (cmd) {
      case 'undo':
        wc.undo()
        break
      case 'redo':
        wc.redo()
        break
      case 'selectAll':
        wc.selectAll()
        break
      case 'cut':
        wc.cut()
        break
      case 'copy':
        wc.copy()
        break
      case 'paste':
        wc.paste()
        break
    }
  },

  'system.openLogs': async () => {
    const file = log.transports.file.getFile().path
    const dir = path.dirname(file)
    await fs.promises.mkdir(dir, { recursive: true })
    const err = await shell.openPath(dir)
    if (err) throw new AppError('io', mt().errors.openLogsFailed, { err })
  },

  'system.redetectTools': async () => {
    const store = requirePrefsStore()
    // Détection neuve : le cache `prefs.tools` peut pointer vers un binaire désinstallé.
    const bins = await resolveBinaries({ tools: {} })
    const next = store.set({ tools: toolsPrefsPatch(bins) })
    await localMediaWorker()
      ?.setTools(mediaToolsOf(bins))
      .catch(() => undefined)
    return next.tools
  },

  'system.takePendingNav': () => takePendingNav(),
  'system.appInfo': () => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node,
    isPackaged: app.isPackaged,
  }),
}
