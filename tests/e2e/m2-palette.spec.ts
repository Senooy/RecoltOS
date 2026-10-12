/**
 * M2 : palette ⌘K — ouverture par le menu natif seulement, géométrie, modes, commandes,
 * « Récemment consultés » = `viewed_at` les plus récents.
 */
import type { ElectronApplication } from '@playwright/test'
import { expect, test } from '../helpers/e2e-fixtures'

const t = (id: string) => `[data-testid="${id}"]`

async function clickMenu(app: ElectronApplication, id: string): Promise<boolean> {
  return app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    if (!item) return false
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    item.click()
    return true
  }, id)
}

test.describe('palette ⌘K', () => {
  test.use({ demoLibrary: { count: 60, collections: 6 } })

  test('ouverture par le menu, géométrie, modes, création de collection', async ({
    app,
    page,
    openDbReadonly,
  }) => {
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
    // Aucun écouteur ⌘K côté renderer : la touche synthétique (qui ne passe pas par le menu) ne
    // l'ouvre pas ; seul l'item de menu « palette » le fait.
    await page.keyboard.press('Meta+k')
    await page.waitForTimeout(200)
    await expect(page.locator(t('palette'))).toHaveCount(0)
    expect(await clickMenu(app, 'palette')).toBe(true)
    const palette = page.locator(t('palette'))
    await expect(palette).toBeVisible()
    const box = await palette.boundingBox()
    expect(box!.width).toBe(520)
    expect(Math.abs(box!.y - 146)).toBeLessThanOrEqual(4)
    const item = await page.locator(t('palette-command')).first().boundingBox()
    expect(Math.abs(item!.height - 33)).toBeLessThanOrEqual(1)
    const footer = await page.locator(t('palette-footer')).boundingBox()
    // Pied de 30 pt.
    expect(footer!.height).toBe(30)
    await expect(page.locator(t('palette-command')).first()).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.locator(t('palette-command')).first()).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0.08)',
    )
    await expect(page.locator(t('palette-command'))).toHaveCount(15)

    // `>` : commandes seules.
    const input = page.locator(t('palette-input'))
    await input.fill('>')
    await expect(page.locator(t('palette-recent'))).toHaveCount(0)
    await expect(page.locator(t('palette-command'))).toHaveCount(15)

    // Échap ferme.
    await page.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)

    // « nouv » puis ↵ : « Nouvelle collection » demande un nom et crée la collection.
    await clickMenu(app, 'palette')
    await input.fill('nouv')
    await expect(page.locator(t('palette-command')).first()).toHaveAttribute(
      'data-command',
      'newCollection',
    )
    await page.keyboard.press('Enter')
    const dialog = page.locator(t('app-dialog'))
    await expect(dialog).toBeVisible()
    await dialog.locator('input').fill('Depuis la palette')
    await page.keyboard.press('Enter')
    const db = openDbReadonly()
    await expect
      .poll(() =>
        db.prepare("SELECT count(*) n FROM collections WHERE name = 'Depuis la palette'").get(),
      )
      .toEqual({ n: 1 })
  })

  test('« Récemment consultés » suit viewed_at (7 vignettes au plus)', async ({
    app,
    page,
    openDbReadonly,
  }) => {
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
    const db = openDbReadonly()
    const uuids = (
      db
        .prepare(
          'SELECT uuid FROM items WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY id LIMIT 3',
        )
        .all() as { uuid: string }[]
    ).map((r) => r.uuid)
    for (const uuid of uuids) {
      await page.evaluate((u) => window.recolt!.invoke('items.markViewed', { uuid: u }), uuid)
      await page.waitForTimeout(30)
    }
    // markViewed est débouncé à 1 s par élément.
    await expect
      .poll(
        () =>
          (
            db
              .prepare(
                'SELECT count(*) n FROM items WHERE viewed_at IS NOT NULL AND uuid IN (SELECT value FROM json_each(?))',
              )
              .get(JSON.stringify(uuids)) as { n: number }
          ).n,
        { timeout: 5000 },
      )
      .toBe(3)
    const expected = (
      db
        .prepare(
          'SELECT uuid FROM items WHERE viewed_at IS NOT NULL AND deleted_at IS NULL AND hidden_at IS NULL ORDER BY viewed_at DESC LIMIT 7',
        )
        .all() as { uuid: string }[]
    ).map((r) => r.uuid)
    await clickMenu(app, 'palette')
    const thumbs = page.locator(t('palette-recent-item'))
    await expect(thumbs).toHaveCount(expected.length)
    expect(await thumbs.evaluateAll((els) => els.map((e) => e.getAttribute('data-uuid')))).toEqual(
      expected,
    )
    // ↑ depuis la 1re commande entre dans la rangée ; →/← s'y déplacent.
    await page.keyboard.press('ArrowUp')
    await expect(thumbs.first()).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(thumbs.nth(1)).toHaveAttribute('aria-selected', 'true')
  })
})
