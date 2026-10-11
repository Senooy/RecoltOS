/**
 * M3 (WP-32) : Redécouvrir — ouverture par le menu, exactement 3 cibles, →/←/↑ et glisser à la
 * souris modifient la base, ⌘Z annule, Échap quitte.
 */
import type { ElectronApplication, Page } from '@playwright/test'
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

const topUuid = (page: Page) => page.locator(t('rd-card')).getAttribute('data-uuid')

test.describe('Redécouvrir', () => {
  test.use({ demoLibrary: { count: 30, collections: 3 } })

  test('clavier, souris, annulation et sortie', async ({ app, page, openDbReadonly }) => {
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
    expect(await clickMenu(app, 'rediscover')).toBe(true)
    await expect(page.locator(t('rediscover'))).toBeVisible()
    await expect(page.locator('[data-testid^="rd-target-"]')).toHaveCount(3)
    await expect(page.locator(t('rd-counter'))).toHaveText(/^1 \/ \d+$/)
    const db = openDbReadonly()
    const row = (u: string | null) =>
      db.prepare('SELECT view_count, deleted_at FROM items WHERE uuid = ?').get(u) as {
        view_count: number
        deleted_at: number | null
      }

    // → garder
    const a = await topUuid(page)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => row(a).view_count).toBe(1)
    await expect(page.locator(t('rd-counter'))).toHaveText(/^2 \//)

    // ← corbeille, puis ⌘Z (menu) annule
    const b = await topUuid(page)
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => row(b).deleted_at).not.toBeNull()
    expect(await clickMenu(app, 'undo')).toBe(true)
    await expect.poll(() => row(b).deleted_at).toBeNull()
    await expect.poll(() => topUuid(page)).toBe(b)

    // ↑ collection : le sélecteur s'ouvre sur la cible du haut
    await page.keyboard.press('ArrowUp')
    const picker = page.locator(t('collection-picker'))
    await expect(picker).toBeVisible()
    await picker.locator(t('collection-picker-item')).first().click()
    await expect
      .poll(
        () =>
          (
            db
              .prepare(
                `SELECT count(*) n FROM collection_items ci JOIN items i ON i.id = ci.item_id
                 WHERE i.uuid = ?`,
              )
              .get(b) as { n: number }
          ).n,
      )
      .toBeGreaterThan(0)

    // Glisser à la souris vers la droite = garder
    const c = await topUuid(page)
    const box = (await page.locator(t('rd-card')).boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(cx + i * 20, cy + 4)
    await expect(page.locator(`${t('rd-target-keep')} .rd-target`)).toHaveClass(/is-active/)
    await page.mouse.up()
    await expect.poll(() => row(c).view_count).toBe(1)

    // Relâchée près du centre : rien ne change
    const d = await topUuid(page)
    const box2 = (await page.locator(t('rd-card')).boundingBox())!
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2)
    await page.mouse.down()
    await page.mouse.move(box2.x + box2.width / 2 + 40, box2.y + box2.height / 2, { steps: 8 })
    await page.waitForTimeout(150)
    await page.mouse.up()
    await page.waitForTimeout(300)
    expect(await topUuid(page)).toBe(d)
    expect(row(d)).toEqual({ view_count: 0, deleted_at: null })

    await page.keyboard.press('Escape')
    await expect(page.locator(t('rediscover'))).toHaveCount(0)
  })
})
