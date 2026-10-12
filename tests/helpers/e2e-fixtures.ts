/**
 * Playwright fixtures shared by the e2e scenarios (`tests/e2e/*.spec.ts`):
 *   import { test, expect } from '../helpers/e2e-fixtures'
 *   test('…', async ({ page, app, userData }) => { … })
 * Each test launches the app with a fresh `userData` and FAILS at the end on any unallowed `console.error` /
 * `pageerror` (including CSP violations, including during the initial load: rereading the
 * messages kept by Playwright via `flushErrors()`). Override: `test.use({ allowErrors: [/…/] })`.
 *
 * Demo library: `test.use({ demoLibrary: true })` (or `{ count, collections… }`)
 * clones the cache of `demo-library.ts` (60 saves, 6 collections, media, avatars) into `userData`
 * BEFORE launch; `openDbReadonly()` then opens the app's database read-only (closed
 * at the end of the test) to verify what it wrote.
 */
import { test as base, expect, type ElectronApplication, type Page } from '@playwright/test'
import { libraryDbPath, openDbReadonly as openReadonly, type TestDb } from './db'
import { makeDemoLibrary, type DemoOptions } from './demo-library'
import { launchApp, type LaunchOptions } from './electron-app'
import { makeTmpDir, removeTmpDir } from './tmpdir'

interface Fixtures {
  allowErrors: RegExp[]
  appLaunch: LaunchOptions
  /** `true` (60 saves, 6 collections) or options of `makeDemoLibrary`: pre-filled userData. */
  demoLibrary: boolean | DemoOptions
  /** Opens the library database (`default` by default) read-only; closed at teardown. */
  openDbReadonly: (libraryId?: string) => TestDb
  app: ElectronApplication
  page: Page
  userData: string
  /** Console errors collected so far (read-only). Prefer `collectErrors()`. */
  consoleErrors: string[]
  /**
   * Rereads the errors kept by Playwright (including those emitted before the listeners were set, during
   * load) and returns the full list. Use it for any "0 errors" assertion.
   */
  collectErrors: () => Promise<string[]>
}

export const test = base.extend<Fixtures>({
  allowErrors: [[], { option: true }],
  appLaunch: [{}, { option: true }],
  demoLibrary: [false, { option: true }],
  // Internal fixture: a single instance per test, shared by app / page / userData.
  app: async ({ allowErrors, appLaunch, demoLibrary }, use) => {
    let seeded: string | undefined
    if (demoLibrary) {
      seeded = appLaunch.userData ?? makeTmpDir('userdata')
      await makeDemoLibrary(seeded, demoLibrary === true ? {} : demoLibrary)
    }
    let handle: Awaited<ReturnType<typeof launchApp>>
    try {
      handle = await launchApp({
        ...appLaunch,
        ...(seeded ? { userData: seeded } : {}),
        allowErrors,
      })
    } catch (err) {
      if (seeded && !appLaunch.userData) removeTmpDir(seeded)
      throw err
    }
    ;(handle.app as ElectronApplication & { __handle?: typeof handle }).__handle = handle
    await use(handle.app)
    // Before closing: the windows must still be there to reread their kept errors.
    const errors = [...(await handle.flushErrors().catch(() => handle.errors))]
    await handle.close()
    // The `userData` created here is not deleted by `close()` (it is not "its own").
    if (seeded && !appLaunch.userData) removeTmpDir(seeded)
    expect(errors, 'erreurs console / pageerror pendant le test').toEqual([])
  },
  page: async ({ app }, use) => {
    await use(await app.firstWindow())
  },
  userData: async ({ app }, use) => {
    const h = (app as ElectronApplication & { __handle?: { userData: string } }).__handle
    await use(h?.userData ?? '')
  },
  openDbReadonly: async ({ userData }, use) => {
    const opened: TestDb[] = []
    await use((libraryId = 'default') => {
      const db = openReadonly(libraryDbPath(userData, libraryId))
      opened.push(db)
      return db
    })
    for (const db of opened) if (db.open) db.close()
  },
  consoleErrors: async ({ app }, use) => {
    const h = (app as ElectronApplication & { __handle?: { errors: string[] } }).__handle
    await use(h?.errors ?? [])
  },
  collectErrors: async ({ app }, use) => {
    const h = (app as ElectronApplication & { __handle?: { flushErrors: () => Promise<string[]> } })
      .__handle
    await use(async () => [...((await h?.flushErrors()) ?? [])])
  },
})

export { expect }
