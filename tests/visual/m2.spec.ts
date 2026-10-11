/**
 * Références visuelles M2 (WP-2F) sur la bibliothèque de démo déterministe : étagère, vue
 * Collection, Recherche, palette ⌘K, Réglages › Données. La boucle de fidélité contre `zzrib6`,
 * `c7j4tx`, `ejjk79`, `25w3t4`, `o86neo` se fait sur la vraie bibliothèque (`pnpm run shots
 * --library real`) ; ces baselines gardent le rendu stable ensuite.
 */
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '../helpers/e2e-fixtures'

const t = (id: string) => `[data-testid="${id}"]`

test.use({
  demoLibrary: { count: 60, collections: 6 },
  appLaunch: { windowSize: '1280x820', deviceScaleFactor: 1 },
})

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(1, 1)
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLImageElement>('img')).every((img) => img.complete),
  )
  await page.waitForTimeout(400)
}

async function ready(page: Page) {
  await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
}

async function clickMenu(app: ElectronApplication, id: string) {
  await app.evaluate(({ Menu }, menuId) => {
    Menu.getApplicationMenu()?.getMenuItemById(menuId)?.click()
  }, id)
}

test('collections-shelf-light', async ({ page }) => {
  await ready(page)
  await page.locator(t('seg-collections')).click()
  await expect(page.locator(t('shelf-cover')).first()).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('collections-shelf-light.png')
})

test('collection-light', async ({ page }) => {
  await ready(page)
  await page.locator(t('seg-collections')).click()
  await page.locator(t('shelf-cover')).first().click()
  await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('collection-light.png')
})

test('search-light', async ({ page }) => {
  await ready(page)
  await page.locator(t('seg-search')).click()
  await expect(page.locator(t('search-input'))).toBeFocused()
  await settle(page)
  await expect(page).toHaveScreenshot('search-light.png', { caret: 'hide' })
})

test('palette-light', async ({ app, page }) => {
  await ready(page)
  await clickMenu(app, 'palette')
  await expect(page.locator(t('palette'))).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('palette-light.png', { caret: 'hide' })
})

test('settings-data-light', async ({ page }) => {
  await ready(page)
  await page.locator(t('btn-settings')).click()
  await page.locator(t('settings-nav-data')).click()
  await settle(page)
  await expect(page).toHaveScreenshot('settings-data-light.png')
})
