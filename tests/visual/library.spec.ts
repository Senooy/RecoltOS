/**
 * Référence visuelle M1 (WP-1F) : Bibliothèque, onglet Tout, thème clair, bibliothèque de démo
 * déterministe. La boucle de fidélité contre `uqre2k` se fait sur la vraie bibliothèque importée
 * (`pnpm run shots --library real`, hors CI) ; cette baseline garde le rendu stable ensuite.
 */
import { expect, test } from '../helpers/e2e-fixtures'

test.use({
  demoLibrary: { count: 60, collections: 6 },
  appLaunch: { windowSize: '1280x820', deviceScaleFactor: 1 },
})

test('library-all-light', async ({ page }) => {
  await expect(page.locator('[data-testid="grid"] [data-testid="card"]').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(1, 1)
  // Toutes les images visibles chargées (pas de fondu en cours).
  await page.waitForFunction(() =>
    Array.from(
      document.querySelectorAll<HTMLImageElement>(
        '[data-testid="grid"] img, [data-testid="collection-card"] img',
      ),
    ).every((img) => img.complete),
  )
  await page.waitForTimeout(300)
  await expect(page).toHaveScreenshot('library-all-light.png', { fullPage: false })
})
