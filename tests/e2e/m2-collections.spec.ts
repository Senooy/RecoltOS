/**
 * M2 (WP-20, WP-21) : étagère 3D des collections et vue Collection (bibliothèque de démo).
 */
import type { Page } from '@playwright/test'
import { expect, test } from '../helpers/e2e-fixtures'

const t = (id: string) => `[data-testid="${id}"]`

async function openShelf(page: Page) {
  await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
  await page.locator(t('seg-collections')).click()
  await expect(page.locator(t('shelf-cover')).first()).toBeVisible()
}

test.describe('étagère et vue Collection', () => {
  test.use({ demoLibrary: { count: 60, collections: 6 } })

  test('étagère : couvertures, libellés au pas de 122 px, segmented sombre, clavier', async ({
    page,
    openDbReadonly,
  }) => {
    await openShelf(page)
    const db = openDbReadonly()
    const n = (
      db.prepare('SELECT count(*) n FROM collections WHERE parent_id IS NULL').get() as {
        n: number
      }
    ).n
    await expect(page.locator(t('shelf-cover'))).toHaveCount(n)
    await expect(page.locator(t('shelf-new'))).toHaveCount(1)
    const labels = await page
      .locator(t('shelf-label'))
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).getBoundingClientRect().x))
    expect(labels[0]).toBeCloseTo(150, 0)
    expect(labels[1]! - labels[0]!).toBeCloseTo(122, 0)
    // Segmented sombre (DESIGN §3.4) et en-tête réduit.
    const nav = page.locator(t('nav-segmented'))
    await expect(nav).toHaveCSS('background-color', 'rgb(22, 22, 24)')
    await expect(page.locator(t('library-picker'))).toHaveCount(0)
    // Jamais plus de 4 vidéos, jamais l'original.
    const videos = await page
      .locator(`${t('shelf')} video`)
      .evaluateAll((els) => els.map((e) => (e as HTMLVideoElement).getAttribute('src') ?? ''))
    expect(videos.length).toBeLessThanOrEqual(4)
    for (const src of videos) expect(src).toContain('/previews/')
    // Clavier : → puis ↵ ouvre la 1re collection ; Échap depuis l'étagère revient à la Bibliothèque.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page.locator(t('collection-title'))).toBeVisible()
    await page.locator(t('seg-collections')).click()
    await expect(page.locator(t('shelf-cover')).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator(t('seg-library'))).toHaveAttribute('aria-current', 'page')
  })

  test('vue Collection : renommage en ligne, sous-collection, cycle refusé, suppression', async ({
    page,
    openDbReadonly,
  }) => {
    await openShelf(page)
    await page.locator(t('shelf-cover')).first().click()
    const title = page.locator(t('collection-title'))
    await expect(title).toBeVisible()
    const original = (await title.innerText()).trim()
    const db = openDbReadonly()
    const parent = db.prepare('SELECT id, uuid FROM collections WHERE name = ?').get(original) as {
      id: number
      uuid: string
    }
    const members = (
      db
        .prepare(
          'SELECT count(*) n FROM collection_items ci JOIN items i ON i.id = ci.item_id WHERE ci.collection_id = ? AND i.deleted_at IS NULL',
        )
        .get(parent.id) as { n: number }
    ).n
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
    // Géométrie DESIGN §3.3 (c7j4tx, ±4 px).
    const back = await page.locator(t('collection-back')).boundingBox()
    expect(Math.abs(back!.x - 33)).toBeLessThanOrEqual(4)
    expect(back!.width).toBe(30)
    const label = await page.locator(t('collection-inside-label')).boundingBox()
    expect(Math.abs(label!.y + label!.height / 2 - 180)).toBeLessThanOrEqual(4)
    const pill = await page.locator(t('new-subcollection')).boundingBox()
    expect(pill!.height).toBe(36)
    const grid = await page.locator(t('grid')).boundingBox()
    expect(Math.abs(grid!.y - 257)).toBeLessThanOrEqual(4)

    // Échap annule, ↵ valide et persiste.
    await title.click()
    await page.locator(t('collection-title-input')).fill('Annulé')
    await page.keyboard.press('Escape')
    await expect(title).toHaveText(original)
    await title.click()
    await page.locator(t('collection-title-input')).fill('Renommée M2')
    await page.keyboard.press('Enter')
    await expect(title).toHaveText('Renommée M2')
    await expect
      .poll(
        () =>
          (
            db.prepare('SELECT name FROM collections WHERE id = ?').get(parent.id) as {
              name: string
            }
          ).name,
      )
      .toBe('Renommée M2')

    // Sous-collection : pilule avec compteur.
    await page.locator(t('new-subcollection')).click()
    await page.locator(t('new-subcollection-input')).fill('Enfant')
    await page.keyboard.press('Enter')
    const sub = page.locator(t('subcollection-pill'), { hasText: 'Enfant' })
    await expect(sub).toContainText('0')

    // Cycle : déplacer le parent dans son enfant est refusé avec un message.
    await page.locator(t('collection-more')).click()
    await page.locator(t('collection-move')).click()
    await page.locator(t('collection-picker-filter')).fill('Enfant')
    await page.locator(t('collection-picker-item'), { hasText: 'Enfant' }).click()
    await expect(page.getByText(/sous-collection|cycle|elle-même/i).first()).toBeVisible()
    expect(
      (
        db.prepare('SELECT parent_id FROM collections WHERE id = ?').get(parent.id) as {
          parent_id: number | null
        }
      ).parent_id,
    ).toBeNull()

    // Suppression : confirmation, éléments conservés, retour à l'étagère.
    await page.locator(t('collection-more')).click()
    await page.locator(t('collection-delete')).click()
    await expect(page.locator(t('app-dialog'))).toContainText('sous-collection')
    await page.locator(t('app-dialog')).getByRole('button', { name: 'Supprimer' }).click()
    await expect(page.locator(t('shelf-cover')).first()).toBeVisible()
    await expect
      .poll(() => db.prepare('SELECT count(*) n FROM collections WHERE id = ?').get(parent.id))
      .toEqual({ n: 0 })
    const alive = (
      db.prepare('SELECT count(*) n FROM items WHERE deleted_at IS NULL').get() as { n: number }
    ).n
    expect(alive).toBeGreaterThanOrEqual(members)
  })

  test('cartes de posts : logo X en haut à droite, pas une croix', async ({ page }) => {
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
    const glyph = page.locator(`${t('source-glyph')}[data-source="x"] svg`).first()
    if ((await glyph.count()) === 0) test.skip(true, 'aucun post X dans la démo')
    await expect(glyph).toHaveAttribute('data-glyph', 'x')
    await expect(glyph).toHaveAttribute('fill', 'currentColor')
  })
})
