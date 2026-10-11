/**
 * Références visuelles M4 (WP-4F) : Réglages › IA, état initial (moteur « aucun »). La boucle de
 * fidélité contre `o8zko5` se fait à la main (montage référence | RecoltOS | fondu) ; cette
 * baseline garde le rendu stable ensuite. La ligne « Recherche visuelle » n'est pas reproduite
 * (ERRATA §G) : la 2ᵉ ligne à interrupteur est « Décrire et taguer les nouveaux ajouts ».
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

test('settings-ai-light', async ({ page }) => {
  await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
  await page.locator(t('btn-settings')).click()
  await page.locator(t('settings-nav-ai')).click()
  await expect(page.locator(t('ai-settings'))).toBeVisible()
  await expect(page.locator(t('ai-engine-status'))).toContainText('désactivée')
  await settle(page)
  await expect(page).toHaveScreenshot('settings-ai-light.png')
})
