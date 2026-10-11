/**
 * Fenêtres hors écran (ERRATA §B) : capture de page, rendu de carte post, stage Spaces.
 * Partition non persistante `recolt-offscreen-<uuid>`, sandbox, SANS preload (jamais
 * `window.recolt`), permissions refusées, navigation et téléchargements bloqués,
 * délai de 20 s, destruction après usage.
 */
import { BrowserWindow, session } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppError } from '../../shared/errors'

export const OFFSCREEN_TIMEOUT_MS = 20_000

export interface OffscreenOptions {
  width: number
  height: number
  /** Rendu hors écran Chromium (`webPreferences.offscreen`). */
  offscreen?: boolean
  deviceScaleFactor?: number
  javascript?: boolean
  timeoutMs?: number
}

export type OffscreenRoute = 'tweet-card' | 'space-stage'

/** URL de `renderer/offscreen.html?render=<route>` (serveur Vite en dev, `file://` en prod). */
export function offscreenUrl(route: OffscreenRoute, params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ render: route, ...params }).toString()
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) return `${dev.replace(/\/$/, '')}/offscreen.html?${q}`
  return `${pathToFileURL(path.join(__dirname, '../renderer/offscreen.html')).toString()}?${q}`
}

/**
 * Ouvre une fenêtre hors écran, exécute `run`, puis la détruit (toujours).
 * Rejette avec `AppError('timeout')` au-delà de `timeoutMs`.
 */
export async function withOffscreenWindow<T>(
  opts: OffscreenOptions,
  run: (win: BrowserWindow) => Promise<T>,
): Promise<T> {
  const partition = `recolt-offscreen-${randomUUID()}`
  const ses = session.fromPartition(partition, { cache: false })
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())

  const win = new BrowserWindow({
    show: false,
    width: opts.width,
    height: opts.height,
    useContentSize: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      offscreen: opts.offscreen ?? true,
      javascript: opts.javascript ?? true,
      zoomFactor: 1,
    },
  })
  const wc = win.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (event) => event.preventDefault())
  wc.on('will-redirect', (event) => event.preventDefault())
  wc.on('will-attach-webview', (event) => event.preventDefault())

  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AppError('timeout', 'fenêtre hors écran : délai dépassé')),
      opts.timeoutMs ?? OFFSCREEN_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([run(win), timeout])
  } finally {
    if (timer) clearTimeout(timer)
    if (!win.isDestroyed()) win.destroy()
    void ses.clearStorageData().catch(() => undefined)
  }
}
