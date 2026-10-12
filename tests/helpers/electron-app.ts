/**
 * Launches the Electron app for the Playwright e2e / visual / perf projects.
 * Launches `out/main/index.js` (unpackaged build) with the testability variables:
 * `RECOLTOS_USER_DATA` (a new folder under `.tmp/`), `RECOLTOS_E2E=1`, `RECOLTOS_HOME`,
 * `RECOLTOS_WINDOW=1280x820`, `TZ=Europe/Paris`, `LANG=fr_FR.UTF-8`. Collects `console.error` and
 * `pageerror` (including CSP violations, turned into errors by the browser).
 *
 * Deterministic capture: the `console` / `pageerror` listeners are attached AFTER `electron.launch()`,
 * so errors emitted during the initial load escape them (measured race: 1 launch
 * in 3 only saw them). Playwright nevertheless retains the latest messages and errors of
 * each page since its creation: `flushErrors()` re-reads them (`page.consoleMessages()`,
 * `page.pageErrors()`) and merges them into `errors` (without duplicates). To call before any
 * "0 errors" assertion and before closing; the `e2e-fixtures.ts` fixture does it.
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './paths'
import { makeTmpDir } from './tmpdir'

export interface LaunchOptions {
  /** `userData` imposed (otherwise a new folder deleted on close). */
  userData?: string
  /** `RECOLTOS_HOME` imposed (otherwise a sub-folder of `userData`). */
  home?: string
  /** Window size `LxH` (default 1280x820). */
  windowSize?: string
  /** Pixel density: 1 for tests (default), 2 for `pnpm run shots`. */
  deviceScaleFactor?: 1 | 2
  /** Additional environment variables. */
  env?: Record<string, string>
  /** Additional Electron arguments (after those of the launcher). */
  args?: string[]
  /** Tolerated `console.error` message patterns (to justify in the test). */
  allowErrors?: RegExp[]
  /** Repo root to launch (default: the tests' one). */
  root?: string
}

export interface AppHandle {
  app: ElectronApplication
  page: Page
  userData: string
  home: string
  /** Console / pageerror errors received so far (live listeners), excluding tolerated patterns. */
  errors: string[]
  /**
   * Merges into `errors` the errors retained by Playwright for all open windows
   * (including those emitted before the listeners were attached) and returns the full list, without duplicates.
   */
  flushErrors: () => Promise<string[]>
  close: () => Promise<void>
}

/**
 * Variables inherited from the shell that change Electron's behaviour at launch. They must be
 * ABSENT (not empty) from the environment passed to `electron.launch`: `ELECTRON_RUN_AS_NODE` is tested
 * by presence, and inheriting it (terminals, IDEs) makes `_electron.launch` fail opaquely.
 */
export const INHERITED_ELECTRON_ENV_TO_DROP: readonly string[] = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'NODE_OPTIONS',
  'ELECTRON_RENDERER_URL',
]

/**
 * Environment of the launched app: that of the test process, without the variables above, then the
 * testability settings and finally `extra` (the caller's explicit choice, last).
 */
export function buildLaunchEnv(
  processEnv: NodeJS.ProcessEnv,
  testability: Record<string, string>,
  extra: Record<string, string> = {},
): Record<string, string> {
  const base: Record<string, string> = {}
  for (const [key, value] of Object.entries(processEnv)) {
    if (value === undefined || INHERITED_ELECTRON_ENV_TO_DROP.includes(key)) continue
    base[key] = value
  }
  return { ...base, ...testability, ...extra }
}

export function electronExecutable(root: string = REPO_ROOT): string {
  return createRequire(join(root, 'package.json'))('electron') as string
}

export async function launchApp(options: LaunchOptions = {}): Promise<AppHandle> {
  const root = options.root ?? REPO_ROOT
  const ownsUserData = !options.userData
  // `home` is created next to `userData` when not imposed: it is then deleted with it,
  // including when `userData` is supplied by the caller (otherwise it stayed on disk).
  const ownsHome = !options.home
  const userData = options.userData ?? makeTmpDir('userdata')
  const home = options.home ?? join(userData, '..', `${userData.split('/').pop() ?? 'ud'}-home`)
  mkdirSync(userData, { recursive: true })
  mkdirSync(home, { recursive: true })
  const dsf = options.deviceScaleFactor ?? 1
  const cleanupDirs = (): void => {
    if (ownsUserData) rmSync(userData, { recursive: true, force: true })
    if (ownsHome) rmSync(home, { recursive: true, force: true })
  }

  let app: ElectronApplication
  try {
    app = await electron.launch({
      executablePath: electronExecutable(root),
      cwd: root,
      args: [
        '.',
        `--force-device-scale-factor=${dsf}`,
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        ...(options.args ?? []),
      ],
      // `ELECTRON_RENDERER_URL` and the variables of `INHERITED_ELECTRON_ENV_TO_DROP` are never
      // passed on: the launched app does not inherit the shell's environment nor another test's.
      env: buildLaunchEnv(
        process.env,
        {
          RECOLTOS_USER_DATA: userData,
          RECOLTOS_E2E: '1',
          RECOLTOS_HOME: home,
          RECOLTOS_WINDOW: options.windowSize ?? '1280x820',
          TZ: 'Europe/Paris',
          LANG: 'fr_FR.UTF-8',
          // Simulated system language: French, like the visual baselines and the
          // e2e assertions. An English test passes `env: { RECOLTOS_LANG: 'en' }` or the `ui.language` setting.
          RECOLTOS_LANG: 'fr',
        },
        options.env,
      ),
    })
  } catch (err) {
    cleanupDirs()
    throw err
  }

  const errors: string[] = []
  const allow = options.allowErrors ?? []
  const record = (text: string): void => {
    if (!allow.some((re) => re.test(text)) && !errors.includes(text)) errors.push(text)
  }
  const consoleLine = (text: string): string => `console.error : ${text}`
  const pageErrorLine = (message: string): string => `pageerror : ${message}`
  const watch = (page: Page): void => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') record(consoleLine(msg.text()))
    })
    page.on('pageerror', (err) => record(pageErrorLine(err.message)))
  }
  const flushErrors = async (): Promise<string[]> => {
    for (const w of app.windows()) {
      if (w.isClosed()) continue
      // Loading errors (CSP, inline script) are emitted before `load`: we wait for it, otherwise
      // too early a call would read a still-empty list.
      await w.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined)
      for (const msg of await w.consoleMessages().catch(() => [])) {
        if (msg.type() === 'error') record(consoleLine(msg.text()))
      }
      for (const err of await w.pageErrors().catch(() => [])) record(pageErrorLine(err.message))
    }
    return errors
  }
  const close = async (): Promise<void> => {
    await app.close().catch(() => undefined)
    cleanupDirs()
  }

  // If `firstWindow()` fails (timeout), the launched app is closed and the folders
  // cleaned up before rethrowing the error: otherwise an Electron process stays alive.
  let page: Page
  try {
    app.on('window', watch)
    page = await app.firstWindow()
    watch(page)
  } catch (err) {
    await close()
    throw err
  }

  return {
    app,
    page,
    userData,
    home,
    errors,
    flushErrors,
    close,
  }
}
