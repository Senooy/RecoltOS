/**
 * Références visuelles M6 (WP-6F) : état vide des Spaces (fidélité `35yuga`, disposition seulement :
 * k = 0,5, ERRATA §E), liste avec un space, éditeur (notes, formes, texte, sélection, dock, zoom).
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

const invoke = (page: Page, channel: string, input?: unknown) =>
  page.evaluate(
    ([c, i]) =>
      (
        window as unknown as { recolt: { invoke: (c: string, i: unknown) => Promise<unknown> } }
      ).recolt.invoke(c, i),
    [channel, input] as const,
  ) as Promise<{ ok: boolean; data: { uuid: string } }>

test('spaces-empty-light', async ({ page }) => {
  await page.locator(t('seg-spaces')).click()
  await expect(page.locator(t('space-empty-cta'))).toBeVisible()
  // Disposition 35yuga (640 × 410 à k = 0,5) : titre centré vers y ≈ 434, bouton vers y ≈ 524.
  const title = (await page.getByText('Aucun space pour l’instant').boundingBox())!
  const cta = (await page.locator(t('space-empty-cta')).boundingBox())!
  expect(Math.abs(title.x + title.width / 2 - 640)).toBeLessThanOrEqual(13)
  expect(Math.abs(title.y + title.height / 2 - 434)).toBeLessThanOrEqual(13)
  expect(Math.abs(cta.y + cta.height / 2 - 524)).toBeLessThanOrEqual(13)
  expect(await page.locator('[data-testid="fab"]').count()).toBe(0)
  await settle(page)
  await expect(page).toHaveScreenshot('spaces-empty-light.png')
})

test('spaces-editor-light', async ({ page }) => {
  const { data } = await invoke(page, 'spaces.create', { name: 'Moodboard' })
  const now = 1_790_000_000_000
  const base = { rotation: 0, locked: false, createdAt: now, updatedAt: now }
  const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
  await invoke(page, 'spaces.applyBatch', {
    spaceUuid: data.uuid,
    viewport: { x: 0, y: 0, zoom: 1 },
    delete: [],
    upsert: [
      {
        ...base,
        uuid: id(1),
        type: 'note',
        x: 120,
        y: 80,
        width: 200,
        height: 200,
        z: 0,
        content: 'Palette chaude pour la couverture',
        style: { color: 'yellow', fontSize: 14, align: 'left' },
      },
      {
        ...base,
        uuid: id(2),
        type: 'note',
        x: 350,
        y: 110,
        width: 200,
        height: 200,
        z: 1,
        rotation: -4,
        content: 'Typo : Geist, titres serrés',
        style: { color: 'blue', fontSize: 14, align: 'left' },
      },
      {
        ...base,
        uuid: id(3),
        type: 'shape',
        x: 620,
        y: 90,
        width: 220,
        height: 140,
        z: 2,
        content: 'Idée',
        style: {
          kind: 'rect',
          fill: null,
          fillAlpha: 1,
          stroke: 'ink',
          strokeWidth: 2,
          dash: 'solid',
          radius: 4,
          fontSize: 14,
          textColor: 'ink',
        },
      },
      {
        ...base,
        uuid: id(4),
        type: 'shape',
        x: 880,
        y: 100,
        width: 140,
        height: 140,
        z: 3,
        content: '',
        style: {
          kind: 'ellipse',
          fill: 'yellow',
          fillAlpha: 0.9,
          stroke: 'ink',
          strokeWidth: 2,
          dash: 'solid',
          radius: 0,
          fontSize: 14,
          textColor: 'ink',
        },
      },
      {
        ...base,
        uuid: id(5),
        type: 'text',
        x: 140,
        y: 340,
        width: 380,
        height: 47,
        z: 4,
        content: 'Numéro d’automne',
        style: {
          fontSize: 36,
          weight: 600,
          font: 'sans',
          color: 'ink',
          align: 'left',
          autoWidth: true,
        },
      },
      {
        ...base,
        uuid: id(6),
        type: 'shape',
        x: 640,
        y: 300,
        width: 160,
        height: 130,
        z: 5,
        content: '',
        style: {
          kind: 'triangle',
          fill: 'blue',
          fillAlpha: 0.9,
          stroke: null,
          strokeWidth: 2,
          dash: 'solid',
          radius: 0,
          fontSize: 14,
          textColor: 'ink',
        },
      },
    ],
  })
  await page.locator(t('seg-spaces')).click()
  await expect(page.locator(t('space-card'))).toHaveCount(1)
  await settle(page)
  await expect(page).toHaveScreenshot('spaces-list-light.png')
  await page.locator(t('space-card')).click()
  await expect(page.locator(`${t('space-world')} .space-node`)).toHaveCount(6)
  await page.locator(`[data-node="${id(2)}"]`).click()
  await settle(page)
  await expect(page).toHaveScreenshot('spaces-editor-light.png')
})
