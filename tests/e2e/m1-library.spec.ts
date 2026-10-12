/**
 * M1: shell, native menu, grid, collections row, Settings and GatherOS import
 * from the UI (fake GatherOS library under `RECOLTOS_HOME`).
 */
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '../helpers/e2e-fixtures'
import { makeLegacyLibrary } from '../helpers/legacy-library'
import { makeTmpDir } from '../helpers/tmpdir'

async function clickMenu(app: ElectronApplication, id: string): Promise<boolean> {
  return app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    if (!item) return false
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    item.click()
    return true
  }, id)
}

const bounds = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds())

async function waitGrid(page: Page) {
  await expect(page.locator('[data-testid="grid"] [data-testid="card"]').first()).toBeVisible()
}

test.describe('shell and grid (demo library)', () => {
  test.use({ demoLibrary: { count: 60, collections: 6 } })

  test('FR menu, segmented control, library picker without moving the window', async ({
    app,
    page,
  }) => {
    await waitGrid(page)
    const labels = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.items.map((i) => i.label),
    )
    expect(labels).toEqual(['RecoltOS', 'Fichier', 'Édition', 'Présentation', 'Fenêtre', 'Aide'])
    expect(await clickMenu(app, 'goCollections')).toBe(true)
    await expect(page.locator('[data-testid="seg-collections"]')).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(await clickMenu(app, 'goLibrary')).toBe(true)
    await expect(page.locator('[data-testid="seg-library"]')).toHaveAttribute(
      'aria-current',
      'page',
    )
    const seg = await page.locator('[data-testid="nav-segmented"]').boundingBox()
    expect(seg?.width).toBe(480)
    expect(seg?.height).toBe(52)

    const before = await bounds(app)
    await page.locator('[data-testid="library-picker"]').click()
    const menu = page.locator('[data-testid="library-picker-menu"]')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem').first().click()
    expect(await bounds(app)).toEqual(before)
    await expect(page.locator('.fab-surface')).toBeVisible()
  })

  test('posts measured before render (no shift), windowing, no English text', async ({ page }) => {
    await waitGrid(page)
    const cls = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let sum = 0
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as (PerformanceEntry & {
              value: number
              hadRecentInput: boolean
            })[]) {
              if (!e.hadRecentInput) sum += e.value
            }
          }).observe({ type: 'layout-shift', buffered: true })
          setTimeout(() => resolve(sum), 600)
        }),
    )
    expect(cls).toBe(0)
    const mounted = await page.locator('[data-testid="grid"] [data-testid="card"]').count()
    expect(mounted).toBeLessThanOrEqual(60)
    const text = await page.locator('[data-testid="app-shell"]').innerText()
    for (const en of [
      'Saved',
      'Unsorted',
      'Trash',
      'Hidden',
      'Most recent',
      'New collection',
      'Search',
    ]) {
      expect(text).not.toContain(en)
    }
  })

  test('inline creation of a collection, persisted', async ({ page, openDbReadonly }) => {
    await waitGrid(page)
    await page.locator('[data-testid="new-collection-card"]').click()
    await page.locator('[data-testid="new-collection-input"]').fill('Essai M1')
    await page.keyboard.press('Enter')
    await expect(
      page.locator('[data-testid="collection-card"]', { hasText: 'Essai M1' }),
    ).toContainText('0 élément')
    const db = openDbReadonly()
    expect(db.prepare("SELECT count(*) n FROM collections WHERE name = 'Essai M1'").get()).toEqual({
      n: 1,
    })
  })

  test('context menu: 7 entries, "Delete" last', async ({ page }) => {
    await waitGrid(page)
    await page
      .locator('[data-testid="card"][data-card-kind="image"]')
      .first()
      .click({ button: 'right' })
    const menu = page.locator('[data-testid="ctx-menu"]')
    await expect(menu).toBeVisible()
    const items = menu.locator('[role="menuitem"]')
    // 7 base entries + « Ajouter à un space › ».
    expect(await items.count()).toBe(8)
    await expect(items.last()).toHaveText('Supprimer')
  })
})

const home = makeTmpDir('home-gatheros')

test.describe('GatherOS import from Settings › Libraries', () => {
  test.use({ appLaunch: { home } })

  test.beforeAll(async () => {
    await makeLegacyLibrary(join(home, 'Library', 'Application Support', 'GatherOS'))
  })

  test('detection, import, summary, cards displayed', async ({ page }) => {
    await expect(page.locator('[data-testid="empty-import-gatheros"]')).toBeVisible()
    await page.locator('[data-testid="empty-import-gatheros"]').click()
    await expect(page.locator('[data-testid="settings"]')).toBeVisible()
    const nav = page.locator('[data-testid^="settings-nav-"]')
    expect(await nav.allInnerTexts()).toEqual([
      'Apparence',
      'Bibliothèques',
      'IA',
      'Tags',
      'Capture',
      'Synchronisation',
      'Stockage',
      'Données',
      'À propos',
    ])
    await expect(page.locator('[data-testid="import-detect"]')).toContainText(
      '10 éléments importables',
    )
    await page.locator('[data-testid="import-start"]').click()
    const summary = page.locator('[data-testid="import-summary"]')
    await expect(summary).toBeVisible({ timeout: 30_000 })
    await expect(summary).toContainText('10 éléments importés')
    // M4: « Enrichir » opens the enrichment box (engine to choose: no call).
    await page.locator('[data-testid="import-enrich"]').click()
    await expect(page.locator('[data-testid="ai-enrich"]')).toBeVisible()
    await expect(page.locator('[data-testid="ai-enrich-start"]')).toHaveText('Changer')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="ai-enrich"]')).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="grid"] [data-testid="card"]')).toHaveCount(8)
  })
})
