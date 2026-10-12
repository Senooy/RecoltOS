/**
 * Panneau « Collections » du glisser : glisser une carte de la grille ouvre le panneau du bord
 * droit ; déposer sur une ligne ajoute à la collection (compteur +1, toast « Ajouté à … »), un
 * second dépôt du même élément n'ajoute rien (« Déjà dans … »), ⌘Z (menu) annule l'ajout.
 *
 * Le glisser natif (`webContents.startDrag`) ouvrirait une boucle modale macOS que Playwright ne
 * peut pas terminer : le canal brut `drag` est remplacé, côté main, par un écouteur qui note les
 * charges reçues (le renderer l'appelle toujours : le glisser vers le Finder reste branché).
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

/** Remplace l'écouteur `drag` du main par un enregistreur (pas de session de glisser macOS). */
async function stubNativeDrag(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as unknown as { __drags: unknown[] }
    g.__drags = []
    ipcMain.removeAllListeners('drag')
    ipcMain.on('drag', (_e, payload: unknown) => {
      g.__drags.push(payload)
    })
  })
}

const nativeDrags = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __drags: unknown[] }).__drags.length)

/** `dragstart` sur la carte (comme le geste réel : React lance `startCardDrag`). */
async function startDrag(page: Page, uuid: string): Promise<void> {
  await page.evaluate((u) => {
    const card = document.querySelector(
      `[data-testid="grid"] [data-testid="card"][data-uuid="${u}"]`,
    )!
    card.dispatchEvent(
      new DragEvent('dragstart', {
        dataTransfer: new DataTransfer(),
        bubbles: true,
        cancelable: true,
      }),
    )
  }, uuid)
}

/** Survol puis dépôt sur une ligne du panneau, avec un type `Files` comme le glisser natif. */
async function dropOnRow(page: Page, collectionUuid: string): Promise<void> {
  await page.evaluate((cu) => {
    const row = document.querySelector(`[data-testid="drag-collection-row"][data-uuid="${cu}"]`)!
    const target = row.querySelector('span:not([data-testid])') ?? row
    const r = row.getBoundingClientRect()
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([1, 2, 3])], 'original.png', { type: 'image/png' }))
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(
        new DragEvent(type, {
          dataTransfer: dt,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      )
    }
  }, collectionUuid)
}

test.describe('panneau Collections pendant le glisser', () => {
  test.use({ demoLibrary: { count: 40, collections: 4 } })

  test('glisser, déposer sur une collection, doublon ignoré, ⌘Z', async ({
    app,
    page,
    openDbReadonly,
  }) => {
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
    await stubNativeDrag(app)
    const db = openDbReadonly()
    const col = db
      .prepare(
        'SELECT uuid, name FROM collections WHERE parent_id IS NULL ORDER BY order_index LIMIT 1',
      )
      .get() as { uuid: string; name: string }
    const members = () =>
      (
        db
          .prepare(
            `SELECT count(*) n FROM collection_items ci JOIN collections c ON c.id = ci.collection_id
             JOIN items i ON i.id = ci.item_id WHERE c.uuid = ? AND i.deleted_at IS NULL`,
          )
          .get(col.uuid) as { n: number }
      ).n
    const itemCount = () => (db.prepare('SELECT count(*) n FROM items').get() as { n: number }).n
    const before = members()
    const items = itemCount()

    // Une carte affichée qui n'est pas encore dans la collection.
    const shown = await page
      .locator(`${t('grid')} ${t('card')}`)
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-uuid')!))
    const inCol = new Set(
      (
        db
          .prepare(
            `SELECT i.uuid FROM collection_items ci JOIN items i ON i.id = ci.item_id
             JOIN collections c ON c.id = ci.collection_id WHERE c.uuid = ?`,
          )
          .all(col.uuid) as { uuid: string }[]
      ).map((r) => r.uuid),
    )
    const card = shown.find((u) => !inCol.has(u))!
    expect(card).toBeTruthy()

    const panel = page.locator(t('drag-collections-panel'))
    await expect(panel).toHaveCount(0)
    await startDrag(page, card)
    await expect(panel).toBeVisible()
    await expect.poll(() => nativeDrags(app)).toBe(1)
    await expect(panel).toContainText('Collections')
    const row = panel.locator(`${t('drag-collection-row')}[data-uuid="${col.uuid}"]`)
    await expect(row).toContainText(col.name)
    await expect(row.locator(t('drag-collection-count'))).toHaveText(String(before))
    // Bord droit, sous l'en-tête.
    const box = (await panel.boundingBox())!
    const vw = await page.evaluate(() => window.innerWidth)
    expect(Math.round(box.x + box.width)).toBe(vw)
    expect(box.y).toBeGreaterThanOrEqual(80)

    await dropOnRow(page, col.uuid)
    await expect(row.locator(t('drag-collection-count'))).toHaveText(String(before + 1))
    await expect(page.getByText(`Ajouté à ${col.name}`)).toBeVisible()
    await expect.poll(members).toBe(before + 1)
    await expect(panel).toHaveCount(0)
    // Le calque de dépôt n'a rien importé (glisser interne).
    expect(itemCount()).toBe(items)
    await expect(page.locator(t('drop-overlay'))).toHaveCount(0)

    // Second dépôt du même élément : rien d'ajouté, pas d'entrée d'annulation.
    await startDrag(page, card)
    await expect(panel).toBeVisible()
    await expect(row.locator(t('drag-collection-count'))).toHaveText(String(before + 1))
    await dropOnRow(page, col.uuid)
    await expect(page.getByText(`Déjà dans ${col.name}`)).toBeVisible()
    await expect(panel).toHaveCount(0)
    expect(members()).toBe(before + 1)

    // ⌘Z : l'ajout est annulé, la rangée de collections suit.
    expect(await clickMenu(app, 'undo')).toBe(true)
    await expect.poll(members).toBe(before)
    await expect(page.locator(`${t('collection-card')}[data-uuid="${col.uuid}"]`)).toContainText(
      before > 1 ? `${before} éléments` : `${before} élément`,
    )

    // Échap annule un glisser sans dépôt : le panneau repart.
    await startDrag(page, card)
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    expect(members()).toBe(before)
  })
})
