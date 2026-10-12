/**
 * Main window and close handle
 * (flush of the renderer before ⌘W/⌘Q, 2 s max).
 */
import { BrowserWindow, app, ipcMain, nativeTheme, screen } from 'electron'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import path from 'node:path'
import { getLang } from '../../shared/i18n/lang'
import { PRELOAD_ARG, RAW_CHANNELS } from '../../shared/ipc/channels'
import { getSystemLang } from '../i18n'
import type { RuntimeFlags } from '../bootstrap/env'
import { MIN_WINDOW } from '../bootstrap/env'
import {
  pickRestoreBounds,
  readWindowState,
  writeWindowState,
  type WindowState,
} from './window-state'

export const BG_LIGHT = '#fafafa'
export const BG_DARK = '#0e0e0f'

let win: BrowserWindow | null = null
let options: MainWindowOptions | null = null

export interface MainWindowOptions {
  userData: string
  flags: RuntimeFlags
}

export function rendererIndexPath(): string {
  return path.join(__dirname, '../renderer/index.html')
}
export function preloadPath(): string {
  return path.join(__dirname, '../preload/index.js')
}

export const getMainWindow = (): BrowserWindow | null =>
  win && !win.isDestroyed() && !win.webContents.isDestroyed() ? win : null

export function isDarkNow(): boolean {
  return nativeTheme.shouldUseDarkColors
}

export const backgroundFor = (dark: boolean): string => (dark ? BG_DARK : BG_LIGHT)

/**
 * Guard `backgroundColor` aligned with the effective appearance (automatic macOS switch,
 * `themeSource` changed): without this the background stays in the old theme until restart.
 * Returns the listener removal function.
 */
export function followNativeTheme(
  w: Pick<BrowserWindow, 'isDestroyed' | 'setBackgroundColor'>,
  theme: Pick<typeof nativeTheme, 'on' | 'removeListener' | 'shouldUseDarkColors'> = nativeTheme,
): () => void {
  const onUpdated = () => {
    if (!w.isDestroyed()) w.setBackgroundColor(backgroundFor(theme.shouldUseDarkColors))
  }
  theme.on('updated', onUpdated)
  return () => theme.removeListener('updated', onUpdated)
}

function saveState(w: BrowserWindow, userData: string): void {
  if (w.isDestroyed()) return
  const isFullScreen = w.isFullScreen()
  const isMaximized = w.isMaximized()
  const bounds = isFullScreen || isMaximized ? w.getNormalBounds() : w.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const state: WindowState = {
    version: 1,
    bounds,
    displayId: display.id,
    isMaximized,
    isFullScreen,
  }
  try {
    writeWindowState(userData, state)
  } catch {
    // Non-blocking: the window will open at the default size.
  }
}

export function createMainWindow(opts: MainWindowOptions): BrowserWindow {
  options = opts
  const { flags, userData } = opts
  const dark = isDarkNow()

  let bounds: { x?: number; y?: number; width: number; height: number }
  let maximize = false
  let fullScreen = false
  if (flags.windowSize) {
    bounds = { ...flags.windowSize }
  } else {
    const picked = pickRestoreBounds(
      readWindowState(userData),
      screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea })),
    )
    bounds = picked.bounds
    maximize = picked.maximize
    fullScreen = picked.fullScreen
  }

  const w = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 22, y: 17 },
    backgroundColor: backgroundFor(dark),
    show: false,
    title: 'RecoltOS',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      additionalArguments: [
        `${PRELOAD_ARG.theme}${dark ? 'dark' : 'light'}`,
        `${PRELOAD_ARG.lang}${getLang()}`,
        `${PRELOAD_ARG.systemLang}${getSystemLang()}`,
        ...(flags.e2e ? [PRELOAD_ARG.e2e] : []),
      ],
    },
  })
  win = w
  const stopThemeFollow = followNativeTheme(w)

  if (maximize) w.maximize()
  if (fullScreen) w.setFullScreen(true)

  w.once('ready-to-show', () => {
    if (flags.e2e) w.showInactive()
    else w.show()
  })

  if (!flags.e2e) {
    let timer: NodeJS.Timeout | null = null
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => saveState(w, userData), 400)
    }
    w.on('resize', schedule)
    w.on('move', schedule)
    w.on('close', () => {
      if (timer) clearTimeout(timer)
      saveState(w, userData)
    })
  }

  attachCloseHandshake(w)
  w.on('closed', () => {
    stopThemeFollow()
    if (win === w) win = null
    closeApproved = false
  })

  if (flags.rendererUrl) void w.loadURL(flags.rendererUrl)
  else void w.loadFile(rendererIndexPath())

  return w
}

/** Creates the window if absent and waits for its loading (open-file, notification, navigation). */
export async function ensureMainWindow(): Promise<BrowserWindow> {
  if (!options) throw new Error('createMainWindow() must be called once first')
  const w = getMainWindow() ?? createMainWindow(options)
  if (w.webContents.isLoading()) await once(w.webContents, 'did-finish-load')
  return w
}

let flushing: Promise<void> | null = null

/** Asks the renderer to flush its deferred writes (idempotent, 2 s max, never throws). */
export function flushRenderer(w: BrowserWindow | null = getMainWindow()): Promise<void> {
  if (!w || w.isDestroyed() || w.webContents.isDestroyed()) return Promise.resolve()
  if (flushing) return flushing
  const token = randomUUID()
  flushing = new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t)
      ipcMain.removeListener(RAW_CHANNELS.flushDone, onDone)
      flushing = null
      resolve()
    }
    const onDone = (_e: unknown, tok: unknown) => {
      if (tok === token) done()
    }
    const t = setTimeout(done, 2000)
    ipcMain.on(RAW_CHANNELS.flushDone, onDone)
    try {
      w.webContents.send(RAW_CHANNELS.flushRequest, token)
    } catch {
      done()
    }
  })
  return flushing
}

let closeApproved = false
let quitApproved = false

function attachCloseHandshake(w: BrowserWindow): void {
  w.on('close', (e) => {
    if (closeApproved || quitApproved) return
    e.preventDefault()
    void flushRenderer(w).finally(() => {
      closeApproved = true
      if (!w.isDestroyed()) w.close()
    })
  })
}

/** `before-quit`: flushes the renderer then quits (⌘Q from the Dock works even without a window). */
export function installQuitHandshake(beforeExit: () => Promise<void>): void {
  app.on('before-quit', (e) => {
    if (quitApproved) return
    e.preventDefault()
    void flushRenderer()
      .catch(() => undefined)
      .then(beforeExit)
      .catch(() => undefined)
      .finally(() => {
        quitApproved = true
        closeApproved = true
        app.quit()
      })
  })
}
