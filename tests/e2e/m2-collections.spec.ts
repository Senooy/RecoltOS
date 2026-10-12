/**
 * M2: 3D collections shelf and Collection view (demo library).
 */
import type { Page } from '@playwright/test'
import { expect, test } from '../helpers/e2e-fixtures'

const t = (id: string) => `[data-testid="${id}"]`

async function openShelf(page: Page) {
  await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
  await page.locator(t('seg-collections')).click()
  await expect(page.locator(t('shelf-cover')).first()).toBeVisible()
}

test.describe('shelf and Collection view', () => {
  test.use({ demoLibrary: { count: 60, collections: 6 } })

  test('shelf: covers, labels at 122 px step, dark segmented, keyboard', async ({
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
    // Dark segmented control and reduced header.
    const nav = page.locator(t('nav-segmented'))
    await expect(nav).toHaveCSS('background-color', 'rgb(22, 22, 24)')
    await expect(page.locator(t('library-picker'))).toHaveCount(0)
    // Never more than 4 videos, never the original.
    const videos = await page
      .locator(`${t('shelf')} video`)
      .evaluateAll((els) => els.map((e) => (e as HTMLVideoElement).getAttribute('src') ?? ''))
    expect(videos.length).toBeLessThanOrEqual(4)
    for (const src of videos) expect(src).toContain('/previews/')
    // Keyboard: → then ↵ opens the 1st collection; Escape from the shelf returns to the Library.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page.locator(t('collection-title'))).toBeVisible()
    await page.locator(t('seg-collections')).click()
    await expect(page.locator(t('shelf-cover')).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator(t('seg-library'))).toHaveAttribute('aria-current', 'page')
  })

  test('Collection view: inline rename, sub-collection, refused cycle, deletion', async ({
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
    // Geometry (±4 px).
    const back = await page.locator(t('collection-back')).boundingBox()
    expect(Math.abs(back!.x - 33)).toBeLessThanOrEqual(4)
    expect(back!.width).toBe(30)
    const label = await page.locator(t('collection-inside-label')).boundingBox()
    expect(Math.abs(label!.y + label!.height / 2 - 180)).toBeLessThanOrEqual(4)
    const pill = await page.locator(t('new-subcollection')).boundingBox()
    expect(pill!.height).toBe(36)
    const grid = await page.locator(t('grid')).boundingBox()
    expect(Math.abs(grid!.y - 257)).toBeLessThanOrEqual(4)

    // Escape cancels, ↵ confirms and persists.
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

    // Sub-collection: pill with counter.
    await page.locator(t('new-subcollection')).click()
    await page.locator(t('new-subcollection-input')).fill('Enfant')
    await page.keyboard.press('Enter')
    const sub = page.locator(t('subcollection-pill'), { hasText: 'Enfant' })
    await expect(sub).toContainText('0')

    // Cycle: moving the parent into its child is refused with a message.
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

    // Deletion: confirmation, items kept, back to the shelf.
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

  test('post cards: X logo at top right, not a cross', async ({ page }) => {
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
    const glyph = page.locator(`${t('source-glyph')}[data-source="x"] svg`).first()
    if ((await glyph.count()) === 0) test.skip(true, 'no X post in the demo')
    await expect(glyph).toHaveAttribute('data-glyph', 'x')
    await expect(glyph).toHaveAttribute('fill', 'currentColor')
  })
})
