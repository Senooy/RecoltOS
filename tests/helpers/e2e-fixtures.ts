/**
 * Fixtures Playwright partagées par les scénarios e2e des lots (`tests/e2e/*.spec.ts`) :
 *   import { test, expect } from '../helpers/e2e-fixtures'
 *   test('…', async ({ page, app, userData }) => { … })
 * Chaque test lance l'app avec un `userData` neuf et ÉCHOUE à la fin sur tout `console.error` /
 * `pageerror` non toléré (y compris violation CSP). Surcharge : `test.use({ allowErrors: [/…/] })`.
 */
import { test as base, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, type LaunchOptions } from './electron-app'

interface Fixtures {
  allowErrors: RegExp[]
  appLaunch: LaunchOptions
  app: ElectronApplication
  page: Page
  userData: string
  /** Erreurs console recueillies (lecture seule, pour les assertions fines). */
  consoleErrors: string[]
}

export const test = base.extend<Fixtures>({
  allowErrors: [[], { option: true }],
  appLaunch: [{}, { option: true }],
  // Fixture interne : une seule instance par test, partagée par app / page / userData.
  app: async ({ allowErrors, appLaunch }, use) => {
    const handle = await launchApp({ ...appLaunch, allowErrors })
    ;(handle.app as ElectronApplication & { __handle?: typeof handle }).__handle = handle
    await use(handle.app)
    const errors = [...handle.errors]
    await handle.close()
    expect(errors, 'erreurs console / pageerror pendant le test').toEqual([])
  },
  page: async ({ app }, use) => {
    await use(await app.firstWindow())
  },
  userData: async ({ app }, use) => {
    const h = (app as ElectronApplication & { __handle?: { userData: string } }).__handle
    await use(h?.userData ?? '')
  },
  consoleErrors: async ({ app }, use) => {
    const h = (app as ElectronApplication & { __handle?: { errors: string[] } }).__handle
    await use(h?.errors ?? [])
  },
})

export { expect }
