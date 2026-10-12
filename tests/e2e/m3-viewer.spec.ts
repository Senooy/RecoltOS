/**
 * M3: detail view — opening from the grid, counter = position in the list
 * of origin, ←/→, Escape returns focus to the card, note saved (800 ms), tag added to the database,
 * Details panel (⌘I), native menu, eyedropper (Escape cancels, click = color copied).
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

test.describe('detail view', () => {
  test.use({ demoLibrary: { count: 30, collections: 3 } })

  test('opening, navigation, closing and focus', async ({ page }) => {
    const cards = page.locator(`${t('grid')} ${t('card')}`)
    await expect(cards.first()).toBeVisible()
    const total = await page.locator(`${t('grid')} ${t('card')}`).count()
    const third = cards.nth(2)
    const uuid3 = await third.getAttribute('data-uuid')
    await third.click()
    const detail = page.locator(t('detail'))
    await expect(detail).toBeVisible()
    await expect(detail).toHaveAttribute('data-uuid', uuid3!)
    await expect(page.locator(t('viewer-counter'))).toHaveText(new RegExp(`^3 / \\d+$`))
    expect(total).toBeGreaterThan(3)
    // Details panel: 300 pt on the right, 18 / top 62 / bottom 18.
    const panel = await page.locator(t('details-panel')).boundingBox()
    expect(panel!.width).toBe(300)
    expect(Math.round(panel!.x + panel!.width)).toBe(1280 - 18)
    expect(Math.round(panel!.y)).toBe(62)

    await page.keyboard.press('ArrowRight')
    await expect(page.locator(t('viewer-counter'))).toHaveText(/^4 \/ \d+$/)
    const uuid4 = await detail.getAttribute('data-uuid')
    expect(uuid4).not.toBe(uuid3)
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator(t('viewer-counter'))).toHaveText(/^3 \/ \d+$/)
    await page.keyboard.press('ArrowRight')

    await page.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)
    await expect
      .poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.uuid))
      .toBe(uuid4)
  })

  test('closing: no video keeps playing (not even with sound) outside the Viewer', async ({
    page,
  }) => {
    const card = page.locator(`${t('grid')} ${t('card')}[data-kind="video"]`).first()
    await expect(card).toBeVisible()
    await card.click()
    const detail = page.locator(t('detail'))
    await expect(detail).toBeVisible()
    const video = page.locator(t('viewer-video'))
    await expect(video).toBeVisible()
    // Real playback, with sound (default preference: not muted).
    await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = false
      await v.play()
    })
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true)

    const src = await video.evaluate((v: HTMLVideoElement) => v.currentSrc)

    const playing = () =>
      page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused).length)
    const audible = () =>
      page.evaluate(
        () => [...document.querySelectorAll('video')].filter((v) => !v.paused && !v.muted).length,
      )

    // From the start of the closing animation: no more playback, even if pressed again (Space).
    await page.keyboard.press('Escape')
    expect(await playing()).toBe(0)
    await page.keyboard.press('Space')
    expect(await audible()).toBe(0)
    await expect(detail).toHaveCount(0)
    expect(await playing()).toBe(0)
    // The stream is released: no sound-playing or playing <video> left in the document.
    await page.waitForTimeout(400)
    expect(await audible()).toBe(0)
    expect(await playing()).toBe(0)

    // A non-muted <video> cannot start outside the Viewer (global guard).
    const guarded = await page.evaluate(async (url) => {
      const v = document.createElement('video')
      v.src = url
      document.body.append(v)
      v.muted = false
      await v.play().catch(() => undefined)
      await new Promise((r) => setTimeout(r, 100))
      const paused = v.paused
      v.remove()
      return paused
    }, src)
    expect(guarded).toBe(true)
  })

  test('note (800 ms), tag and ⌘I panel modify the database', async ({
    app,
    page,
    openDbReadonly,
  }) => {
    const card = page.locator(`${t('grid')} ${t('card')}`).first()
    await expect(card).toBeVisible()
    const uuid = await card.getAttribute('data-uuid')
    await card.click()
    await expect(page.locator(t('detail'))).toBeVisible()

    await page.locator(t('detail-add-note')).click()
    await page.locator(t('detail-note')).fill('Une note de test')
    const db = openDbReadonly()
    await expect
      .poll(() => db.prepare('SELECT notes FROM items WHERE uuid = ?').get(uuid), {
        timeout: 4000,
      })
      .toEqual({ notes: 'Une note de test' })

    await page.locator(t('detail-tag-input')).fill('essai-viewer')
    await page.keyboard.press('Enter')
    await expect
      .poll(() =>
        db
          .prepare(
            `SELECT count(*) n FROM item_tags it JOIN tags tg ON tg.id = it.tag_id
             JOIN items i ON i.id = it.item_id WHERE i.uuid = ? AND tg.name = 'essai-viewer'`,
          )
          .get(uuid),
      )
      .toEqual({ n: 1 })
    await expect(page.locator(t('detail-tag'))).toContainText(['# essai-viewer'])

    // ⌘I (native menu) hides then shows the panel again.
    await page.locator(t('viewer-stage')).click({ position: { x: 20, y: 300 } })
    expect(await clickMenu(app, 'toggleDetails')).toBe(true)
    await expect(page.locator(t('details-panel'))).toHaveCount(0)
    expect(await clickMenu(app, 'toggleDetails')).toBe(true)
    await expect(page.locator(t('details-panel'))).toBeVisible()

    // View recorded.
    await expect
      .poll(() => db.prepare('SELECT view_count FROM items WHERE uuid = ?').get(uuid))
      .not.toEqual({ view_count: 0 })
  })

  test('panel swatch → Search filtered by this color', async ({ page }) => {
    const card = page.locator(`${t('grid')} ${t('card')}[data-kind="image"]`).first()
    await expect(card).toBeVisible()
    await card.click()
    const swatch = page.locator(`${t('palette-swatches')} button`).first()
    await expect(swatch).toBeVisible()
    const hex = await swatch.getAttribute('data-hex')
    await swatch.click()
    await expect(page.locator(t('detail'))).toHaveCount(0)
    await expect(page.locator(t('search-page'))).toBeVisible()
    await expect(page.locator(t('search-filter-chip')).first()).toContainText(hex!)
    await expect(page.locator(t('search-count'))).toBeVisible()
  })

  test('eyedropper: Escape cancels, a click on the media copies the color', async ({ page }) => {
    const card = page.locator(`${t('grid')} ${t('card')}[data-kind="image"]`).first()
    await expect(card).toBeVisible()
    await card.click()
    const detail = page.locator(t('detail'))
    const pipette = page.locator(t('viewer-pipette'))
    await pipette.click()
    await expect(detail).toHaveAttribute('data-picking', '')
    await page.keyboard.press('Escape')
    await expect(detail).not.toHaveAttribute('data-picking')
    await expect(detail).toBeVisible()

    await pipette.click()
    await page.locator(t('viewer-media')).click({ position: { x: 40, y: 40 } })
    await expect(page.getByText(/^#[0-9a-f]{6} copié$/)).toBeVisible()
    await expect(detail).not.toHaveAttribute('data-picking')
  })
})
