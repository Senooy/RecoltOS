/**
 * Références visuelles M5 (WP-57) : Réglages › Synchronisation, état initial (aucune extension
 * connectée, trois sources désactivées). Fidélité contre `fte10a` vérifiée en montage (lignes,
 * interrupteurs, note de bas alignés) ; seuls ajouts : lignes d'état, lien « En savoir plus » et,
 * sous la note, la carte « Extension navigateur ».
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
