/**
 * M3 (WP-30) : vue détail — ouverture depuis la grille, compteur = position dans la liste
 * d'origine, ←/→, Échap rend le focus à la carte, note enregistrée (800 ms), tag ajouté en base,
 * panneau Détails (⌘I), menu natif.
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

test.describe('vue détail', () => {
  test.use({ demoLibrary: { count: 30, collections: 3 } })

  test('ouverture, navigation, fermeture et focus', async ({ page }) => {
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
    // Panneau Détails : 300 pt à droite 18 / haut 62 / bas 18.
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

  test('fermeture : aucune vidéo ne continue de jouer (ni avec du son) hors du Viewer', async ({
    page,
  }) => {
    const card = page.locator(`${t('grid')} ${t('card')}[data-kind="video"]`).first()
    await expect(card).toBeVisible()
    await card.click()
    const detail = page.locator(t('detail'))
    await expect(detail).toBeVisible()
    const video = page.locator(t('viewer-video'))
    await expect(video).toBeVisible()
    // Lecture réelle, avec du son (préférence par défaut : non muet).
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

    // Dès le début de l'animation de fermeture : plus de lecture, même si on insiste (Espace).
    await page.keyboard.press('Escape')
    expect(await playing()).toBe(0)
    await page.keyboard.press('Space')
    expect(await audible()).toBe(0)
    await expect(detail).toHaveCount(0)
    expect(await playing()).toBe(0)
    // Le flux est libéré : plus aucun <video> sonore ni en lecture dans le document.
    await page.waitForTimeout(400)
    expect(await audible()).toBe(0)
    expect(await playing()).toBe(0)

    // Un <video> non muet ne peut pas démarrer hors du Viewer (garde globale).
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

  test('note (800 ms), tag et panneau ⌘I modifient la base', async ({
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

    // ⌘I (menu natif) masque puis réaffiche le panneau.
    await page.locator(t('viewer-stage')).click({ position: { x: 20, y: 300 } })
    expect(await clickMenu(app, 'toggleDetails')).toBe(true)
    await expect(page.locator(t('details-panel'))).toHaveCount(0)
    expect(await clickMenu(app, 'toggleDetails')).toBe(true)
    await expect(page.locator(t('details-panel'))).toBeVisible()

    // Vue marquée.
    await expect
      .poll(() => db.prepare('SELECT view_count FROM items WHERE uuid = ?').get(uuid))
      .not.toEqual({ view_count: 0 })
  })

  test('pastille du panneau → Recherche filtrée par cette couleur (WP-31)', async ({ page }) => {
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
})
