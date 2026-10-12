/**
 * M2: ⌘K palette: opened via the native menu only, geometry, modes, commands,
 * "Recently viewed" = the most recent `viewed_at`.
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

  test('opened via the menu, geometry, modes, collection creation', async ({
    app,
    page,
    openDbReadonly,
  }) => {
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
    // No ⌘K listener on the renderer side: the synthetic key (which does not go through the menu) does not
    // open it; only the "palette" menu item does.
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
    // 30 pt footer.
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

    // `>`: commands only.
    const input = page.locator(t('palette-input'))
    await input.fill('>')
    await expect(page.locator(t('palette-recent'))).toHaveCount(0)
    await expect(page.locator(t('palette-command'))).toHaveCount(15)

    // Escape closes.
    await page.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)

    // "nouv" then ↵: "New collection" asks for a name and creates the collection.
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

  test('"Recently viewed" follows viewed_at (7 thumbnails at most)', async ({
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
    // markViewed is debounced to 1 s per item.
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
    // ↑ from the 1st command enters the row; →/← move within it.
    await page.keyboard.press('ArrowUp')
    await expect(thumbs.first()).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(thumbs.nth(1)).toHaveAttribute('aria-selected', 'true')
  })
})
