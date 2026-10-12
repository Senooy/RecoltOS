/**
 * Off-screen windows: page capture, post card rendering, Spaces stage.
 * Non-persistent partition `recolt-offscreen-<n>`, sandbox, WITHOUT preload (never
 * `window.recolt`), permissions denied, page-initiated navigation and downloads
 * blocked, 20 s timeout, destroyed after use.
 *
 * Redirects: a `preventDefault` on `will-redirect` cancels the WHOLE navigation
 * (`loadURL` rejected with `ERR_FAILED`); so we only accept http(s) → http(s) redirects,
 * within the limit of `MAX_REDIRECTS` hops (http→https, short links, trailing slash).
 *
 * Sessions: Electron never frees a `Session`. Partitions are therefore recycled via a
 * small pool (`partitionPool`): a partition is taken for the duration of a call, cleared
 * (`clearStorageData` + `clearCache`) then returned. The number of sessions created is bounded by the
 * maximum observed concurrency, not by the number of calls (rendering hundreds of cards).
 */
import { BrowserWindow, session, type Session } from 'electron'
import path from 'node:path'
import { getLang } from '../../shared/i18n/lang'
import { pathToFileURL } from 'node:url'
import { AppError } from '../../shared/errors'

export const OFFSCREEN_TIMEOUT_MS = 20_000
export const MAX_REDIRECTS = 10

export interface OffscreenOptions {
  width: number
  height: number
  /** Chromium off-screen rendering (`webPreferences.offscreen`). */
  offscreen?: boolean
  deviceScaleFactor?: number
  javascript?: boolean
  timeoutMs?: number
}

export type OffscreenRoute = 'tweet-card' | 'space-stage'

/** URL of `renderer/offscreen.html?render=<route>` (Vite server in dev, `file://` in prod). */
export function offscreenUrl(route: OffscreenRoute, params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ render: route, lang: getLang(), ...params }).toString()
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) return `${dev.replace(/\/$/, '')}/offscreen.html?${q}`
  return `${pathToFileURL(path.join(__dirname, '../renderer/offscreen.html')).toString()}?${q}`
}

/** Accepted redirect: http(s) → http(s); neither `file:`, nor `data:`, nor an app scheme. */
export function isAllowedRedirect(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

let partitionCounter = 0
/** Idle partitions, ready to be reused. */
const partitionPool: string[] = []

/**
 * Additional configuration of each off-screen session. `protocol.handle` only applies to the
 * session it is called on: without this hook, `recolt://` (avatars and media of
 * the post card, Spaces stage thumbnails) fails in off-screen partitions. It
 * registers `recolt:` there (read-only, same roots as the default session).
 * The function is called on each partition created, and on those already created at registration.
 */
export type OffscreenSessionSetup = (ses: Session) => void
const sessionSetups: OffscreenSessionSetup[] = []
const createdSessions: Session[] = []

export function registerOffscreenSessionSetup(fn: OffscreenSessionSetup): void {
  sessionSetups.push(fn)
  for (const ses of createdSessions) fn(ses)
}

/** Tests only. */
export function resetOffscreenForTests(): void {
  sessionSetups.length = 0
  createdSessions.length = 0
  partitionPool.length = 0
  partitionCounter = 0
}

/** Takes a partition from the pool or creates one (exported for tests). */
export function acquirePartition(): string {
  const reused = partitionPool.pop()
  if (reused) return reused
  const partition = `recolt-offscreen-${++partitionCounter}`
  const ses = session.fromPartition(partition, { cache: false })
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())
  createdSessions.push(ses)
  for (const fn of sessionSetups) fn(ses)
  return partition
}

async function releasePartition(partition: string): Promise<void> {
  const ses = session.fromPartition(partition, { cache: false })
  try {
    await Promise.race([
      Promise.all([ses.clearStorageData(), ses.clearCache()]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('clear')), 5_000)),
    ])
    partitionPool.push(partition)
  } catch {
    // Partition possibly polluted: we do not reuse it.
  }
}

/**
 * Opens an off-screen window, runs `run`, then destroys it (always).
 * Rejects with `AppError('timeout')` beyond `timeoutMs`.
 */
export async function withOffscreenWindow<T>(
  opts: OffscreenOptions,
  run: (win: BrowserWindow) => Promise<T>,
): Promise<T> {
  const partition = acquirePartition()

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
  // `will-navigate` only fires for navigations initiated by the page.
  wc.on('will-navigate', (event) => event.preventDefault())
  let redirects = 0
  wc.on('will-redirect', (event, url) => {
    redirects += 1
    if (redirects > MAX_REDIRECTS || !isAllowedRedirect(url)) event.preventDefault()
  })
  wc.on('will-attach-webview', (event) => event.preventDefault())

  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AppError('timeout', 'offscreen window: timed out')),
      opts.timeoutMs ?? OFFSCREEN_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([run(win), timeout])
  } finally {
    if (timer) clearTimeout(timer)
    if (!win.isDestroyed()) win.destroy()
    await releasePartition(partition)
  }
}
