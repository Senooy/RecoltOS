/**
 * Références visuelles SOMBRES (WP-70) sur la bibliothèque de démo déterministe : les 13 scènes de
 * départ (QA §7.1) plus l'éditeur Spaces et Réglages › Apparence. Le thème est basculé par le
 * bouton de l'en-tête (chemin réel de l'utilisateur, bascule instantanée) avant chaque scène.
 * Les surfaces immersives (détail, étagère, Redécouvrir) doivent être identiques aux baselines
 * claires à la teinte du voile près. La boucle de fidélité se fait sur la vraie bibliothèque
 * (`pnpm run shots --library real --theme dark`) ; ces baselines gardent le rendu stable ensuite.
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

/** Grille prête puis thème sombre par le bouton de l'en-tête. */
async function darkReady(page: Page) {
  await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
  await page.locator(t('btn-theme')).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  // La bascule ne laisse aucune transition en cours : le marqueur disparaît en deux images.
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-switching', '1')
}

async function clickMenu(app: ElectronApplication, id: string) {
  await app.evaluate(({ Menu }, menuId) => {
    Menu.getApplicationMenu()?.getMenuItemById(menuId)?.click()
  }, id)
}

async function settings(page: Page, section: string) {
  await page.locator(t('btn-settings')).click()
  await page.locator(t(`settings-nav-${section}`)).click()
  await expect(page.locator(t(`settings-section-${section}`))).toBeVisible()
}

test('library-all-dark', async ({ app, page }) => {
  await darkReady(page)
  // Fond de fenêtre natif aligné sur le thème (pas de bord clair au redimensionnement).
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.getBackgroundColor().toLowerCase(),
      ),
    )
    .toMatch(/^#(ff)?0e0e0f$/)
  await settle(page)
  await expect(page).toHaveScreenshot('library-all-dark.png')
})

test('detail-image-dark', async ({ page }) => {
  await darkReady(page)
  await page
    .locator(`${t('grid')} ${t('card')}[data-kind="image"]`)
    .first()
    .click()
  await expect(page.locator(t('details-panel'))).toBeVisible()
  await page.mouse.move(1270, 10)
  await settle(page)
  await expect(page).toHaveScreenshot('detail-image-dark.png')
})

test('palette-dark', async ({ app, page }) => {
  await darkReady(page)
  await clickMenu(app, 'palette')
  await expect(page.locator(t('palette'))).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('palette-dark.png', { caret: 'hide' })
})

test('collections-shelf-dark', async ({ page }) => {
  await darkReady(page)
  await page.locator(t('seg-collections')).click()
  await expect(page.locator(t('shelf-cover')).first()).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('collections-shelf-dark.png')
})

test('rediscover-dark', async ({ app, page }) => {
  await darkReady(page)
  await clickMenu(app, 'rediscover')
  await expect(page.locator(t('rd-card'))).toBeVisible()
  await page.mouse.move(1, 400)
  await settle(page)
  await expect(page).toHaveScreenshot('rediscover-dark.png')
})

test('context-menu-dark', async ({ page }) => {
  await darkReady(page)
  await page
    .locator(`${t('grid')} ${t('card')}`)
    .nth(2)
    .click({ button: 'right' })
  await expect(page.locator(t('ctx-menu'))).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('context-menu-dark.png')
})

test('collection-dark', async ({ page }) => {
  await darkReady(page)
  await page.locator(t('seg-collections')).click()
  await page.locator(t('shelf-cover')).first().click()
  await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('collection-dark.png')
})

test('search-dark', async ({ page }) => {
  await darkReady(page)
  await page.locator(t('seg-search')).click()
  await expect(page.locator(t('search-input'))).toBeFocused()
  await settle(page)
  await expect(page).toHaveScreenshot('search-dark.png', { caret: 'hide' })
})

test('spaces-empty-dark', async ({ page }) => {
  await darkReady(page)
  await page.locator(t('seg-spaces')).click()
  await expect(page.locator(t('space-empty-cta'))).toBeVisible()
  await settle(page)
  await expect(page).toHaveScreenshot('spaces-empty-dark.png')
})

test('spaces-editor-dark', async ({ page }) => {
  await darkReady(page)
  const invoke = (channel: string, input?: unknown) =>
    page.evaluate(
      ([c, i]) =>
        (
          window as unknown as {
            recolt: { invoke: (c: string, i: unknown) => Promise<unknown> }
          }
        ).recolt.invoke(c, i),
      [channel, input] as const,
    ) as Promise<{ ok: boolean; data: { uuid: string } }>
  const { data } = await invoke('spaces.create', { name: 'Moodboard' })
  const now = 1_790_000_000_000
  const base = { rotation: 0, locked: false, createdAt: now, updatedAt: now }
  const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
  const shape = (kind: string, fill: string | null) => ({
    kind,
    fill,
    fillAlpha: 0.9,
    stroke: 'ink',
    strokeWidth: 2,
    dash: 'solid',
    radius: 4,
    fontSize: 14,
    textColor: 'ink',
  })
  await invoke('spaces.applyBatch', {
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
        type: 'shape',
        x: 620,
        y: 90,
        width: 220,
        height: 140,
        z: 1,
        content: 'Idée',
        style: shape('rect', null),
      },
      {
        ...base,
        uuid: id(3),
        type: 'shape',
        x: 880,
        y: 100,
        width: 140,
        height: 140,
        z: 2,
        content: '',
        style: shape('ellipse', 'blue'),
      },
      {
        ...base,
        uuid: id(4),
        type: 'text',
        x: 140,
        y: 340,
        width: 380,
        height: 47,
        z: 3,
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
    ],
  })
  await page.locator(t('seg-spaces')).click()
  await page.locator(t('space-card')).click()
  await expect(page.locator(`${t('space-world')} .space-node`)).toHaveCount(4)
  await page.locator(`[data-node="${id(2)}"]`).click()
  await settle(page)
  await expect(page).toHaveScreenshot('spaces-editor-dark.png')
})

for (const [name, section] of [
  ['settings-libraries-dark', 'libraries'],
  ['settings-sync-dark', 'sync'],
  ['settings-capture-dark', 'capture'],
  ['settings-ai-dark', 'ai'],
  ['settings-appearance-dark', 'appearance'],
] as const) {
  test(name, async ({ page }) => {
    await darkReady(page)
    await settings(page, section)
    await settle(page)
    await expect(page).toHaveScreenshot(`${name}.png`)
  })
}
