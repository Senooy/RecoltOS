/**
 * `updates` domain: automatic updates from GitHub Releases (electron-updater, provider `github`,
 * public releases, no token). Everything goes through main: the renderer keeps its CSP without
 * network access and reads the state through `updates.*` and `evt:updates.status`.
 *
 * - Nothing at startup: electron-updater is loaded (`require`) and the signature is read only after
 *   the window's first paint, then the first check runs ~30 s later, then every 6 h, while
 *   `updates.auto` is on. A manual check (Settings › About, menu) works whatever the setting.
 * - Disabled without noise in dev (`!isPackaged`), e2e, and for any build not signed with a
 *   Developer ID (ad hoc or "RecoltOS Local": Squirrel.Mac would refuse the update anyway).
 * - Background download; once ready, installed on restart (`updates.install`) or when the app
 *   quits (`autoInstallOnAppQuit`; the quit handshake ends with `app.quit()`, so `quit` fires).
 * - Errors: logged only. An automatic check that fails leaves the previous state; no retry
 *   before the next slot. Only a manual check shows the error in Settings.
 */
import { app, type BrowserWindow } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { UpdateStatus } from '../../shared/ipc/updates'
import type { Disposer, ServiceContext } from '../bootstrap/context'
import type { Logger } from '../bootstrap/log'
import { requirePrefsStore } from '../prefs/store'

/** Same values as `publish` in `electron-builder.config.cjs` (embedded as `app-update.yml`). */
export const UPDATE_FEED = {
  provider: 'github',
  owner: 'Senooy',
  repo: 'RecoltOS',
  releaseType: 'release',
} as const

export const FIRST_CHECK_DELAY_MS = 30_000
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

type State = UpdateStatus['status']

interface Runtime {
  ctx: ServiceContext
  log: Logger
  status: State
  /** `null` = not determined yet; the promise is shared by every caller. */
  support: Promise<boolean> | null
  updater: AppUpdater | null
  checking: Promise<void> | null
  firstTimer: NodeJS.Timeout | null
  interval: NodeJS.Timeout | null
  painted: boolean
  disposed: boolean
}

let rt: Runtime | null = null

const currentVersion = (): string => app.getVersion()

function snapshot(status: State): UpdateStatus {
  return { currentVersion: currentVersion(), status }
}

function setStatus(r: Runtime, status: State): void {
  r.status = status
  if (!r.disposed) r.ctx.emit('updates.status', snapshot(status))
}

/** First line of an error, without a URL query string (no token is ever sent, but stay sober). */
function shortMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const line = raw.split('\n')[0] ?? ''
  return line.replace(/\?\S*/g, '').slice(0, 200) || 'Unknown error'
}

/** Bundle path: `…/RecoltOS.app/Contents/MacOS/RecoltOS` → `…/RecoltOS.app`. */
function appBundlePath(): string {
  return path.resolve(process.execPath, '..', '..', '..')
}

/** `codesign --display` of the running app: signed with a Developer ID Application identity. */
function isDeveloperIdSigned(bundle: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'codesign',
      ['--display', '--verbose=2', bundle],
      { timeout: 10_000 },
      (err, _stdout, stderr) => {
        if (err) return resolve(false)
        const out = String(stderr)
        resolve(
          /^Authority=Developer ID Application: /m.test(out) &&
            /^TeamIdentifier=[A-Z0-9]{10}$/m.test(out),
        )
      },
    )
  })
}

function supported(r: Runtime): Promise<boolean> {
  if (r.support) return r.support
  const { ctx } = r
  if (!ctx.isPackaged || ctx.flags.e2e || process.platform !== 'darwin') {
    r.support = Promise.resolve(false)
  } else {
    r.support = isDeveloperIdSigned(appBundlePath()).then((ok) => {
      if (!ok) r.log.info('[updates] build not signed with a Developer ID: updates disabled')
      return ok
    })
  }
  return r.support
}

/** Loads electron-updater on first use (never at startup) and wires its events. */
function loadUpdater(r: Runtime): AppUpdater {
  if (r.updater) return r.updater
  const req = createRequire(__filename)
  const { autoUpdater } = req('electron-updater') as { autoUpdater: AppUpdater }
  // electron-updater logs every error itself: kept in the log file, at the warning level.
  autoUpdater.logger = {
    info: (...a: unknown[]) => r.log.info('[updates]', ...a),
    warn: (...a: unknown[]) => r.log.warn('[updates]', ...a),
    error: (...a: unknown[]) => r.log.warn('[updates]', ...a),
    debug: () => undefined,
  }
  autoUpdater.setFeedURL({ ...UPDATE_FEED })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

  autoUpdater.on('update-available', (info) => {
    setStatus(r, { state: 'downloading', version: info.version, percent: 0 })
  })
  autoUpdater.on('download-progress', (p) => {
    const version = r.status.state === 'downloading' ? r.status.version : ''
    const percent = Math.max(0, Math.min(100, Math.round(p.percent)))
    setStatus(r, { state: 'downloading', version, percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    r.log.info(`[updates] ${info.version} downloaded, installed on restart`)
    stopSchedule(r)
    setStatus(r, { state: 'ready', version: info.version })
  })
  // Mandatory listener (an `error` event without a listener throws); the state is handled by `check`.
  autoUpdater.on('error', () => undefined)
  r.updater = autoUpdater
  return autoUpdater
}

/**
 * One check at a time. `manual`: shows the error in Settings; an automatic check that fails
 * goes back to the previous state, silently.
 */
function check(r: Runtime, manual: boolean): Promise<void> {
  if (r.checking) return r.checking
  if (r.status.state === 'ready' || r.status.state === 'downloading') return Promise.resolve()
  const run = (async () => {
    if (!(await supported(r))) {
      if (r.status.state !== 'unsupported') setStatus(r, { state: 'unsupported' })
      return
    }
    const previous = r.status
    let updater: AppUpdater
    try {
      updater = loadUpdater(r)
    } catch (err) {
      r.log.warn('[updates] electron-updater unavailable', err)
      setStatus(r, { state: 'unsupported' })
      return
    }
    setStatus(r, { state: 'checking' })
    try {
      const result = await updater.checkForUpdates()
      // `isUpdateAvailable` false (or `null`: updater inactive): up to date.
      if (!result?.isUpdateAvailable) {
        setStatus(r, { state: 'upToDate', checkedAt: Date.now() })
        return
      }
      if (r.status.state === 'checking') {
        setStatus(r, { state: 'downloading', version: result.updateInfo.version, percent: 0 })
      }
      // The download continues in the background; its failure is handled like a check failure.
      result.downloadPromise?.catch((err: unknown) => fail(r, err, manual, previous))
    } catch (err) {
      fail(r, err, manual, previous)
    }
  })()
  r.checking = run.finally(() => {
    r.checking = null
  })
  return r.checking
}

function fail(r: Runtime, err: unknown, manual: boolean, previous: State): void {
  r.log.warn('[updates] check or download failed', shortMessage(err))
  if (r.status.state === 'ready') return
  if (manual) setStatus(r, { state: 'error', message: shortMessage(err) })
  else setStatus(r, previous.state === 'checking' ? { state: 'idle' } : previous)
}

function stopSchedule(r: Runtime): void {
  if (r.firstTimer) clearTimeout(r.firstTimer)
  if (r.interval) clearInterval(r.interval)
  r.firstTimer = null
  r.interval = null
}

/** Automatic checks: ~30 s after the first paint (or after turning the setting on), then every 6 h. */
function startSchedule(r: Runtime): void {
  stopSchedule(r)
  if (r.disposed || !r.painted || r.status.state === 'ready') return
  if (!requirePrefsStore().get().updates.auto) return
  r.firstTimer = setTimeout(() => {
    r.firstTimer = null
    void check(r, false)
  }, FIRST_CHECK_DELAY_MS)
  r.firstTimer.unref?.()
  r.interval = setInterval(() => void check(r, false), CHECK_INTERVAL_MS)
  r.interval.unref?.()
}

/** Resolves after the main window's first paint (`ready-to-show`), or right away if it is shown. */
function afterFirstPaint(ctx: ServiceContext, cb: () => void): () => void {
  let done = false
  const fire = () => {
    if (done) return
    done = true
    cb()
  }
  const w = ctx.getMainWindow()
  if (w?.isVisible()) {
    fire()
    return () => undefined
  }
  if (w) {
    w.once('ready-to-show', fire)
    return () => {
      if (!w.isDestroyed()) w.removeListener('ready-to-show', fire)
    }
  }
  // No window yet (it opens at the end of the services): first one created.
  const onCreated = (_e: unknown, created: BrowserWindow) => {
    app.removeListener('browser-window-created', onCreated)
    created.once('ready-to-show', fire)
  }
  app.on('browser-window-created', onCreated)
  return () => app.removeListener('browser-window-created', onCreated)
}

export function getUpdateStatus(): UpdateStatus {
  return snapshot(rt?.status ?? { state: 'unsupported' })
}

export async function checkForUpdatesNow(): Promise<UpdateStatus> {
  const r = rt
  if (!r) return getUpdateStatus()
  await check(r, true)
  return getUpdateStatus()
}

/** Restarts on the downloaded update (`ready` state); otherwise does nothing. */
export function installUpdate(): void {
  const r = rt
  if (!r?.updater || r.status.state !== 'ready') return
  const updater = r.updater
  setImmediate(() => updater.quitAndInstall())
}

export function initUpdates(ctx: ServiceContext): Disposer {
  const r: Runtime = {
    ctx,
    log: ctx.log,
    status: !ctx.isPackaged || ctx.flags.e2e ? { state: 'unsupported' } : { state: 'idle' },
    support: null,
    updater: null,
    checking: null,
    firstTimer: null,
    interval: null,
    painted: false,
    disposed: false,
  }
  rt = r
  if (r.status.state === 'unsupported') {
    return () => {
      r.disposed = true
      if (rt === r) rt = null
    }
  }

  const offPaint = afterFirstPaint(ctx, () => {
    r.painted = true
    // Signature read once the window is on screen; an unsupported build stays silent.
    void supported(r).then((ok) => {
      if (!ok) setStatus(r, { state: 'unsupported' })
      else startSchedule(r)
    })
  })
  const offPrefs = requirePrefsStore().onChange((next, previous) => {
    if (next.updates.auto === previous.updates.auto) return
    if (!next.updates.auto) stopSchedule(r)
    else void supported(r).then((ok) => ok && startSchedule(r))
  })

  return () => {
    r.disposed = true
    offPaint()
    offPrefs()
    stopSchedule(r)
    if (rt === r) rt = null
  }
}
