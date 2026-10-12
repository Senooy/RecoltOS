/**
 * Visual regression: Settings › Sync, initial state (no extension
 * connected, three sources disabled): status rows, "Learn more" link and, below the
 * note, the "Browser extension" card.
 */
import type { Page } from '@playwright/test'
import { expect, test } from '../helpers/e2e-fixtures'

const t = (id: string) => `[data-testid="${id}"]`

test.use({
  demoLibrary: { count: 12, collections: 2 },
  appLaunch: { windowSize: '1280x820', deviceScaleFactor: 1 },
})

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
}

test('settings-sync-light', async ({ page }) => {
  await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
  await page.locator(t('btn-settings')).click()
  await page.locator(t('settings-nav-sync')).click()
  await expect(page.locator(t('sync-settings'))).toBeVisible()
  await expect(page.locator(t('sync-ext-state'))).toContainText('Non détectée')
  await settle(page)
  await expect(page).toHaveScreenshot('settings-sync-light.png')
})
