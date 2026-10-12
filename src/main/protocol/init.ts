/**
 * Initialization of the `protocol` domain (`bootstrap/services.ts` registry):
 *  - `protocol.handle('recolt')` on the default session AND on each off-screen session
 *    (`registerOffscreenSessionSetup`, read-only, same roots, reserved for the internal page
 *    `offscreen.html`: a captured http(s) page gets 403, see `offscreen-guard.ts`); the privileged scheme is
 *    declared before `ready` by `bootstrap/pre-ready.ts`;
 *  - raw `drag` channel (drag to the Finder);
 *  - local media-worker for `system.copyImage` until one is provided.
 * Outside Electron (Node tests of the registry), nothing is wired up.
 */
import { app, ipcMain, nativeImage, protocol, webContents } from 'electron'
import path from 'node:path'
import type { Disposer, ServiceContext } from '../bootstrap/context'
import { registerDrag, makeDragIcon } from '../drag'
import { makeSenderCheck } from '../ipc/router'
import { getActiveLibrary, registerLibraryLifecycle } from '../library/library-context'
import { getPrefsStore } from '../prefs/store'
import { SIPS_PATH } from '../platform/binaries'
import { rendererIndexPath } from '../windows/main-window'
import { registerOffscreenSessionSetup } from '../windows/offscreen'
import { createMediaWorker } from '../workers-host'
import { makeUtilityFork, mediaWorkerPath } from '../workers/utility-fork'
import { dragFiles } from './item-files'
import { guardOffscreenHandler } from './offscreen-guard'
import { setLocalMediaWorkerFactory, stopLocalMediaWorker } from './media-worker'
import { RECOLT_PROTOCOL, createRecoltHandler, type RecoltHandler } from './recolt-protocol'

/** `resources/drag-fallback.png`, next to `package.json` (dev) or in the asar (packaged). */
export function dragFallbackPath(appPath: string): string {
  return path.join(appPath, 'resources', 'drag-fallback.png')
}

export function makeLibraryResolver() {
  return (id: string) => {
    const lib = getActiveLibrary()
    return lib && lib.id === id ? { id: lib.id, root: lib.root } : null
  }
}

let handler: RecoltHandler | null = null

/** Top-level URL of the live windows that use `ses`. */
function pageUrlsOfSession(ses: unknown): string[] {
  return webContents
    .getAllWebContents()
    .filter((wc) => !wc.isDestroyed() && wc.session === ses)
    .map((wc) => wc.getURL())
}

/** Current handler (sessions created outside this module, tests). */
export function getRecoltHandler(): RecoltHandler | null {
  return handler
}

export function initProtocol(ctx: ServiceContext): Disposer | void {
  if (typeof protocol?.handle !== 'function') {
    ctx.log.warn('[protocol] outside Electron: recolt:// not registered')
    return
  }

  const h = createRecoltHandler({
    libraryFor: makeLibraryResolver(),
    onDenied: (reason, url) => ctx.log.warn(`[protocol] denied (${reason}): ${url}`),
  })
  handler = h
  if (protocol.isProtocolHandled(RECOLT_PROTOCOL)) protocol.unhandle(RECOLT_PROTOCOL)
  protocol.handle(RECOLT_PROTOCOL, h)

  registerOffscreenSessionSetup((ses) => {
    if (ses.protocol.isProtocolHandled(RECOLT_PROTOCOL)) return
    // Delegates to the current handler: a domain reset does not have to touch these sessions.
    // Guard: only internal pages (`offscreen.html`) read the library, never a
    // remote page captured in the same recycled partition (see `offscreen-guard.ts`).
    ses.protocol.handle(
      RECOLT_PROTOCOL,
      guardOffscreenHandler(ses, (req) => (handler ?? h)(req), {
        pageUrlsOf: pageUrlsOfSession,
        rendererUrl: ctx.flags.rendererUrl,
        onDenied: (reason, url) => ctx.log.warn(`[protocol] denied (${reason}): ${url}`),
      }),
    )
  })

  const disposeLifecycle = registerLibraryLifecycle('protocol', {
    afterOpen: () => h.clearCache(),
  })

  const fallback = dragFallbackPath(app.getAppPath())
  const disposeDrag = registerDrag({
    ipcMain,
    isAllowedSender: makeSenderCheck({
      rendererUrl: ctx.flags.rendererUrl,
      rendererIndexPath: rendererIndexPath(),
    }),
    files: (uuids) => {
      const lib = getActiveLibrary()
      return lib ? dragFiles(lib, uuids) : []
    },
    icon: (dataUrl) => makeDragIcon(nativeImage, fallback, dataUrl),
    log: ctx.log,
  })

  setLocalMediaWorkerFactory(() =>
    createMediaWorker({
      modulePath: mediaWorkerPath(),
      fork: makeUtilityFork(ctx.log),
      tools: localTools(),
      log: ctx.log,
    }),
  )

  return async () => {
    disposeDrag()
    disposeLifecycle()
    setLocalMediaWorkerFactory(null)
    await stopLocalMediaWorker()
    if (protocol.isProtocolHandled(RECOLT_PROTOCOL)) protocol.unhandle(RECOLT_PROTOCOL)
    handler = null
  }
}

/** Known tools of the local worker (`toPng` only uses sharp; ffmpeg remains optional). */
function localTools(): { ffmpeg?: string; ffprobe?: string; sips: string } {
  const tools = getPrefsStore()?.get().tools ?? {}
  return {
    sips: SIPS_PATH,
    ...(tools.ffmpeg ? { ffmpeg: tools.ffmpeg } : {}),
    ...(tools.ffprobe ? { ffprobe: tools.ffprobe } : {}),
  }
}
