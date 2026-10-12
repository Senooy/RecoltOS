/**
 * `capture` domain: capture service, global shortcut (inactive under `RECOLTOS_E2E`),
 * the « Capturer l'écran » menu item consistent with the layout, drop folder initialized
 * to the Desktop on first launch, notifications.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { app, globalShortcut, screen } from 'electron'
import type { ServiceContext } from '../bootstrap/context'
import { clipboardImageHash, readClipboardImage, writeClipboardPng } from '../import-ux/clipboard'
import { ingest } from '../ingest/ingest'
import { ingestDeps } from '../ipc/handlers/ingest'
import { rebuildMenu } from '../menu'
import { requestOpenItem } from '../nav'
import { requirePrefsStore } from '../prefs/store'
import { ensureMainWindow } from '../windows/main-window'
import { notifyCapture } from './notify'
import { getScreenAccess, provokePrompt } from './permission'
import { runScreencapture, screencaptureBin } from './process'
import { createCaptureService, type CaptureService } from './service'
import {
  createShortcutManager,
  menuAccelerator,
  type GlobalShortcutLike,
  type ShortcutResult,
} from './shortcut'

let service: CaptureService | null = null
let shortcuts: ReturnType<typeof createShortcutManager> | null = null
let registered = false

export function getCaptureService(): CaptureService {
  if (!service) throw new Error('capture not initialized')
  return service
}

export function isShortcutRegistered(): boolean {
  return registered
}

/** In e2e: no system shortcut; `RECOLTOS_SHORTCUT_TAKEN` simulates a conflict (tests). */
function e2eShortcuts(env = process.env): GlobalShortcutLike {
  return {
    register: (accel) => accel !== env.RECOLTOS_SHORTCUT_TAKEN,
    unregister: () => undefined,
  }
}

/** Index of the screen under the cursor (`-D`, 1 = main). */
function displayIndex(): number {
  try {
    const primary = screen.getPrimaryDisplay()
    const all = [primary, ...screen.getAllDisplays().filter((d) => d.id !== primary.id)]
    const cur = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    return Math.max(1, all.findIndex((d) => d.id === cur.id) + 1)
  } catch {
    return 1
  }
}

/** Applies a new shortcut (immediately); saved to the prefs only if it is successfully registered. */
export function setCaptureShortcut(accel: string, label: string): ShortcutResult {
  if (!shortcuts || !service) return { ok: false, error: 'invalid' }
  const svc = service
  const r = shortcuts.set(accel, () => void svc.run({ trigger: 'shortcut' }))
  if (r.ok) {
    registered = true
    requirePrefsStore().set({ capture: { shortcut: accel, shortcutLabel: label } })
    rebuildMenu({ capture: menuAccelerator(accel, label) ?? null })
  }
  return r
}

export function initCapture(ctx: ServiceContext): () => void {
  const prefs = requirePrefsStore()
  const tmpDir = path.join(ctx.userData, 'tmp-capture')

  service = createCaptureService({
    prefs: () => prefs.get().capture,
    access: () => getScreenAccess(),
    provokePrompt: () => provokePrompt(),
    markPromptShown: () => {
      prefs.set({ capture: { promptShown: true } })
    },
    getWindow: () => ctx.getMainWindow(),
    bin: screencaptureBin(ctx.isPackaged),
    run: (bin, args) => runScreencapture(bin, args),
    tmpDir,
    displayIndex,
    clipboard: {
      hash: clipboardImageHash,
      png: readClipboardImage,
      writeImage: async (file) => writeClipboardPng(await readFile(file)),
    },
    ingest: async (file, collectionUuid) =>
      ingest(
        { type: 'capture', path: file, mode: prefs.get().capture.mode },
        collectionUuid ? { collectionUuid } : {},
        ingestDeps(),
      ),
    notify: (r) =>
      notifyCapture(
        {
          getMainWindow: () => ctx.getMainWindow(),
          ensureMainWindow,
          openItem: requestOpenItem,
        },
        'permission' in r ? { kind: 'permission' } : { kind: 'done', ...r },
      ),
    emitPermissionRequired: (access) => ctx.emit('capture.permissionRequired', { access }),
    emitDone: (r) => ctx.emit('capture.done', r),
    log: ctx.log,
  })

  // Drop folder: the Desktop is proposed on first launch.
  const cap = prefs.get().capture
  if (!cap.dropFolderInit && !ctx.flags.e2e) {
    prefs.set({
      capture: { dropFolderInit: true, dropFolder: cap.dropFolder ?? app.getPath('desktop') },
    })
  }

  shortcuts = createShortcutManager(ctx.flags.e2e ? e2eShortcuts() : globalShortcut)
  const { shortcut, shortcutLabel } = prefs.get().capture
  const svc = service
  const r = shortcuts.set(shortcut, () => void svc.run({ trigger: 'shortcut' }))
  registered = r.ok
  if (!r.ok) ctx.log.warn(`[capture] shortcut ${shortcut} not registered: ${r.error}`)
  rebuildMenu({ capture: menuAccelerator(shortcut, shortcutLabel) ?? null })

  return () => {
    shortcuts?.dispose()
    shortcuts = null
    registered = false
    service = null
  }
}
