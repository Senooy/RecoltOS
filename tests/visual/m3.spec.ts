/**
 * Visual regression on the deterministic demo library: detail view (image),
 * Rediscover (fixed seed 42 under e2e), Settings › Capture, context menu.
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

test('detail-image-light', async ({ page }) => {
  await ready(page)
  await page
    .locator(`${t('grid')} ${t('card')}[data-kind="image"]`)
    .first()
    .click()
  await expect(page.locator(t('details-panel'))).toBeVisible()
  await page.mouse.move(1270, 10)
  await settle(page)
  await expect(page).toHaveScreenshot('detail-image-light.png')
})

test('rediscover-light', async ({ app, page }) => {
  await ready(page)
  await clickMenu(app, 'rediscover')
  await expect(page.locator(t('rd-card'))).toBeVisible()
  await page.mouse.move(1, 400)
  await settle(page)
  await expect(page).toHaveScreenshot('rediscover-light.png')
})

test('settings-capture-light', async ({ page }) => {
  await ready(page)
  await page.locator(t('btn-settings')).click()
  await page.locator(t('settings-nav-capture')).click()
  await expect(page.locator(t('capture-settings'))).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('settings-capture-light.png')
})

test('context-menu-light', async ({ page }) => {
  await ready(page)
  await page
    .locator(`${t('grid')} ${t('card')}`)
    .nth(2)
    .click({ button: 'right' })
  await expect(page.locator(t('ctx-menu'))).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('context-menu-light.png')
})
