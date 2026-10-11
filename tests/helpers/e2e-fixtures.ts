/**
 * Fixtures Playwright partagées par les scénarios e2e des lots (`tests/e2e/*.spec.ts`) :
 *   import { test, expect } from '../helpers/e2e-fixtures'
 *   test('…', async ({ page, app, userData }) => { … })
 * Chaque test lance l'app avec un `userData` neuf et ÉCHOUE à la fin sur tout `console.error` /
 * `pageerror` non toléré (y compris violation CSP, y compris au chargement initial : relecture des
 * messages retenus par Playwright via `flushErrors()`). Surcharge : `test.use({ allowErrors: [/…/] })`.
 *
 * Bibliothèque de démo (QA §6.1) : `test.use({ demoLibrary: true })` (ou `{ count, collections… }`)
 * clone le cache de `demo-library.ts` (60 saves, 6 collections, médias, avatars) dans `userData`
 * AVANT le lancement ; `openDbReadonly()` ouvre ensuite la base de l'app en lecture seule (fermée
 * en fin de test) pour vérifier ce qu'elle a écrit.
 */
import { test as base, expect, type ElectronApplication, type Page } from '@playwright/test'
import { libraryDbPath, openDbReadonly as openReadonly, type TestDb } from './db'
import { makeDemoLibrary, type DemoOptions } from './demo-library'
import { launchApp, type LaunchOptions } from './electron-app'
import { makeTmpDir, removeTmpDir } from './tmpdir'

interface Fixtures {
  allowErrors: RegExp[]
  appLaunch: LaunchOptions
  /** `true` (60 saves, 6 collections) ou options de `makeDemoLibrary` : userData pré-rempli. */
  demoLibrary: boolean | DemoOptions
  /** Ouvre la base de la bibliothèque (`default` par défaut) en lecture seule ; fermée au teardown. */
  openDbReadonly: (libraryId?: string) => TestDb
  app: ElectronApplication
  page: Page
  userData: string
  /** Erreurs console recueillies jusqu'ici (lecture seule). Préférer `collectErrors()`. */
  consoleErrors: string[]
  /**
   * Relit les erreurs retenues par Playwright (dont celles émises avant la pose des écouteurs, au
   * chargement) et renvoie la liste complète. À utiliser pour toute assertion « 0 erreur ».
   */
  collectErrors: () => Promise<string[]>
}

export const test = base.extend<Fixtures>({
  allowErrors: [[], { option: true }],
  appLaunch: [{}, { option: true }],
  demoLibrary: [false, { option: true }],
  // Fixture interne : une seule instance par test, partagée par app / page / userData.
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
    // Avant la fermeture : les fenêtres doivent encore être là pour relire leurs erreurs retenues.
    const errors = [...(await handle.flushErrors().catch(() => handle.errors))]
    await handle.close()
    // Le `userData` fabriqué ici n'est pas supprimé par `close()` (il n'est pas « à lui »).
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
