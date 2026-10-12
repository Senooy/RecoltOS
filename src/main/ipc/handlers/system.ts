/**
 * `system.*` handlers:
 * revealInFinder, openExternal (http(s) only), copyImage (`toPng` from the media worker →
 * `clipboard.write([ClipboardItem image/png])`, poster for a video), copyText, saveAs, quickLook
 * (`previewFile`), edit (`webContents.<cmd>()`), openLogs, redetectTools, appInfo.
 * The original is always given as is (never a derivative), except for the image copy.
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

/** Longest side of the copied image (an original of 50 Mpx would give a huge PNG). */
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

/** Name suggested by "Save as": cleaned title + extension of the original. */
export function suggestedFileName(title: string | null | undefined, original: string): string {
  const ext = path.extname(original)
  const base = (title ?? '')
    .normalize('NFC')
    // No separator, no control character, no ":" (shown as "/" by Finder).
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
    // The contract (`WebUrl`) already enforces it; defense in depth before handing over to macOS.
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
    // Electron 44: `clipboard.writeImage` no longer exists; `write([ClipboardItem])` (W3C).
    // `nativeImage` is only used to check that the worker's PNG is decodable and non-empty.
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
    // Fresh detection: the `prefs.tools` cache may point to an uninstalled binary.
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
