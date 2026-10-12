/**
 * M2 : page Recherche — géométrie, syntaxe convertie en chips, filtres retirables,
 * historique persistant (8 max) et « Effacer ».
 */
import { expect, test } from '../helpers/e2e-fixtures'

const t = (id: string) => `[data-testid="${id}"]`

test.describe('Recherche', () => {
  test.use({ demoLibrary: { count: 60, collections: 6 } })

  test('champ à y=124, chips de syntaxe, filtres retirables, historique', async ({
    page,
    openDbReadonly,
  }) => {
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
    await page.locator(t('seg-search')).click()
    const input = page.locator(t('search-input'))
    await expect(input).toBeFocused()
    const field = await page.locator('.search-field').boundingBox()
    expect(Math.abs(field!.y - 124)).toBeLessThanOrEqual(4)
    expect(field!.height).toBe(56)
    expect(Math.abs(field!.width - 700)).toBeLessThanOrEqual(4)
    const db = openDbReadonly()
    const all = (
      db
        .prepare('SELECT count(*) n FROM items WHERE deleted_at IS NULL AND hidden_at IS NULL')
        .get() as {
        n: number
      }
    ).n
    await expect(page.locator(t('search-count'))).toContainText(`${all} éléments`)

    // `type:video` devient une chip ; seuls des éléments vidéo restent.
    const videos = (
      db
        .prepare(
          "SELECT count(*) n FROM items WHERE kind = 'video' AND deleted_at IS NULL AND hidden_at IS NULL",
        )
        .get() as { n: number }
    ).n
    await input.pressSequentially('type:video ')
    await expect(page.locator(t('search-filter-chip'))).toHaveText(['Vidéos'])
    await expect(input).toHaveValue('')
    await expect(page.locator(t('search-count'))).toContainText(`${videos} résultat`)
    const kinds = await page
      .locator(`${t('search-results')} ${t('card')}`)
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))
    expect(kinds.every((k) => k === 'video')).toBe(true)
    await page.getByRole('button', { name: 'Retirer le filtre Vidéos' }).click()
    await expect(page.locator(t('search-filter-chip'))).toHaveCount(0)
    await expect(page.locator(t('search-idle'))).toBeVisible()

    // Historique : une recherche gardée apparaît dans « Récents », « Effacer » la vide.
    const title = (
      db
        .prepare(
          "SELECT title FROM items WHERE title IS NOT NULL AND title <> '' AND deleted_at IS NULL AND hidden_at IS NULL LIMIT 1",
        )
        .get() as { title: string }
    ).title
    const word = title.split(/\s+/).find((w) => /^[\p{L}]{4,}$/u.test(w)) ?? title.split(/\s+/)[0]!
    await input.fill(word)
    await input.press('Enter')
    await expect(page.locator(t('search-count'))).toContainText('résultat')
    await expect
      .poll(() => db.prepare('SELECT count(*) n FROM search_history').get())
      .toEqual({ n: 1 })
    await input.fill('')
    await expect(page.locator(t('search-recent-chip'))).toHaveText([word])
    await page.locator(t('search-recent-clear')).click()
    await expect(page.locator(t('search-recent'))).toHaveCount(0)
    await expect
      .poll(() => db.prepare('SELECT count(*) n FROM search_history').get())
      .toEqual({ n: 0 })
  })

  test('aucun résultat : état vide FR', async ({ page }) => {
    await page.locator(t('seg-search')).click()
    await page.locator(t('search-input')).fill('zzzqqqxxyy')
    await expect(page.getByText('Aucun résultat pour « zzzqqqxxyy »')).toBeVisible()
    await expect(page.getByText('Essaie un autre mot, un tag ou une couleur.')).toBeVisible()
  })
})
