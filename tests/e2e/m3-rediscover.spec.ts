/**
 * M3: Rediscover — opened from the menu, exactly 3 targets, →/←/↑ and mouse drag modify the
 * database, ⌘Z undoes, Esc quits.
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

/** Top card, once the previous one is gone (during its exit animation, two `rd-card`). */
const topUuid = async (page: Page) => {
  await expect(page.locator(t('rd-card'))).toHaveCount(1)
  return page.locator(t('rd-card')).getAttribute('data-uuid')
}

test.describe('Rediscover', () => {
  test.use({ demoLibrary: { count: 30, collections: 3 } })

  test('keyboard, mouse, undo and exit', async ({ app, page, openDbReadonly }) => {
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

    // → keep
    const a = await topUuid(page)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => row(a).view_count).toBe(1)
    await expect(page.locator(t('rd-counter'))).toHaveText(/^2 \//)

    // ← trash, then ⌘Z (menu) undoes
    const b = await topUuid(page)
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => row(b).deleted_at).not.toBeNull()
    expect(await clickMenu(app, 'undo')).toBe(true)
    await expect.poll(() => row(b).deleted_at).toBeNull()
    await expect.poll(() => topUuid(page)).toBe(b)

    // ↑ collection: the picker opens on the top target
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
    await expect(page.locator(t('rd-counter'))).toHaveText(/^3 \//)

    // Drag with the mouse to the right = keep
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
    await expect(page.locator(t('rd-counter'))).toHaveText(/^4 \//)

    // Released near the center: nothing changes
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
