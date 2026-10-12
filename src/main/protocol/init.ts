/**
 * Initialisation du domaine `protocol` (registre `bootstrap/services.ts`) :
 *  - `protocol.handle('recolt')` sur la session par défaut ET sur chaque session hors écran
 *    (`registerOffscreenSessionSetup`, lecture seule, mêmes racines, réservé à la page interne
 *    `offscreen.html` : une page http(s) capturée reçoit 403, cf. `offscreen-guard.ts`) ; le schéma privilégié est
 *    déclaré avant `ready` par `bootstrap/pre-ready.ts` ;
 *  - canal brut `drag` (glisser vers le Finder) ;
 *  - media-worker local pour `system.copyImage` tant que n'en fournit pas.
 * Hors Electron (tests Node du registre), rien n'est branché.
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

/** `resources/drag-fallback.png`, à côté de `package.json` (dev) ou dans l'asar (packagé). */
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

/** URL de premier niveau des fenêtres vivantes qui utilisent `ses`. */
function pageUrlsOfSession(ses: unknown): string[] {
  return webContents
    .getAllWebContents()
    .filter((wc) => !wc.isDestroyed() && wc.session === ses)
    .map((wc) => wc.getURL())
}

/** Handler courant (sessions créées hors de ce module, tests). */
export function getRecoltHandler(): RecoltHandler | null {
  return handler
}

export function initProtocol(ctx: ServiceContext): Disposer | void {
  if (typeof protocol?.handle !== 'function') {
    ctx.log.warn('[protocol] hors Electron : recolt:// non enregistré')
    return
  }

  const h = createRecoltHandler({
    libraryFor: makeLibraryResolver(),
    onDenied: (reason, url) => ctx.log.warn(`[protocol] refus (${reason}) : ${url}`),
  })
  handler = h
  if (protocol.isProtocolHandled(RECOLT_PROTOCOL)) protocol.unhandle(RECOLT_PROTOCOL)
  protocol.handle(RECOLT_PROTOCOL, h)

  registerOffscreenSessionSetup((ses) => {
    if (ses.protocol.isProtocolHandled(RECOLT_PROTOCOL)) return
    // Délègue au handler courant : une réinitialisation du domaine n'a pas à toucher ces sessions.
    // Garde : seules les pages internes (`offscreen.html`) lisent la bibliothèque, jamais une page
    // distante capturée dans la même partition recyclée (voir `offscreen-guard.ts`).
    ses.protocol.handle(
      RECOLT_PROTOCOL,
      guardOffscreenHandler(ses, (req) => (handler ?? h)(req), {
        pageUrlsOf: pageUrlsOfSession,
        rendererUrl: ctx.flags.rendererUrl,
        onDenied: (reason, url) => ctx.log.warn(`[protocol] refus (${reason}) : ${url}`),
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

/** Outils connus du worker local (`toPng` n'utilise que sharp ; ffmpeg reste facultatif). */
function localTools(): { ffmpeg?: string; ffprobe?: string; sips: string } {
  const tools = getPrefsStore()?.get().tools ?? {}
  return {
    sips: SIPS_PATH,
    ...(tools.ffmpeg ? { ffmpeg: tools.ffmpeg } : {}),
    ...(tools.ffprobe ? { ffprobe: tools.ffprobe } : {}),
  }
}
