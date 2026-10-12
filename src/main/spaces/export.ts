/**
 * PNG export of a space: destination chosen first (`showSaveDialog`,
 * default `~/Downloads/<name>.png`), then rendering by the stage window with progress
 * (`spaces.exportProgress`) and cancellation (`spaces.exportCancel` → `AbortController`).
 * One export at a time. « Afficher dans le Finder » only shows the last file written.
 */
import { BrowserWindow, app, dialog, nativeTheme, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { z } from 'zod'
import { AppError } from '../../shared/errors'
import type { spacesContract } from '../../shared/ipc/spaces'
import { emitEvent } from '../events'
import type { HandlerContext } from '../ipc/router'
import { requireLibrary } from '../library/library-context'
import { getSpace } from './repo'
import { renderSpacePng } from './stage'
import { mt } from '../i18n'

type ExportInput = z.output<(typeof spacesContract)['spaces.exportPng']['input']>

let controller: AbortController | null = null
let lastExport: string | null = null

const safeName = (name: string) =>
  (
    [...name]
      .map((c) => (c.charCodeAt(0) < 32 || '/\\:*?"<>|'.includes(c) ? ' ' : c))
      .join('')
      .trim() || 'Space'
  ).slice(0, 120)

export async function exportSpacePng(
  input: ExportInput,
  ctx: HandlerContext,
): Promise<{ path: string } | { cancelled: true }> {
  if (controller) throw new AppError('busy', mt().errors.exportBusy)
  const lib = requireLibrary()
  const doc = getSpace(lib, input.uuid)
  const win = ctx.sender ? BrowserWindow.fromWebContents(ctx.sender) : null
  const options = {
    title: mt().dialogs.exportPng,
    defaultPath: path.join(app.getPath('downloads'), `${safeName(input.name)}.png`),
    filters: [{ name: mt().dialogs.pngImage, extensions: ['png'] }],
  }
  const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (r.canceled || !r.filePath) return { cancelled: true }
  const file = r.filePath.toLowerCase().endsWith('.png') ? r.filePath : `${r.filePath}.png`
  controller = new AbortController()
  const theme =
    input.background === 'theme'
      ? nativeTheme.shouldUseDarkColors
        ? 'dark'
        : 'light'
      : input.background
  try {
    const png = await renderSpacePng(
      doc,
      {
        scope: input.scope,
        ...(input.nodeUuids ? { ids: input.nodeUuids } : {}),
        scale: input.scale,
        theme,
      },
      {
        signal: controller.signal,
        onProgress: (done, total) => emitEvent('spaces.exportProgress', { done, total }),
      },
    )
    await writeFile(file, png)
    lastExport = file
    return { path: file }
  } catch (err) {
    if (controller.signal.aborted) return { cancelled: true }
    throw err
  } finally {
    controller = null
  }
}

export function cancelExport(): void {
  controller?.abort()
}

export function revealLastExport(): void {
  if (lastExport) shell.showItemInFolder(lastExport)
}
