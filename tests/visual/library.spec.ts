/**
 * Visual regression: Library, All tab, light theme, demo library
 * deterministic (fake data).
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
  // All visible images loaded (no fade in progress).
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
