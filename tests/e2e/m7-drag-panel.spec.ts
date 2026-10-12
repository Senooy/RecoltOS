/**
 * "Collections" panel during a drag: dragging a grid card opens the right-edge panel;
 * dropping on a row adds to the collection (counter +1, toast « Added to … »), a
 * second drop of the same item adds nothing (« Already in … »), ⌘Z (menu) undoes the add.
 *
 * The native drag (`webContents.startDrag`) would open a macOS modal loop that Playwright cannot
 * end: the raw `drag` channel is replaced, on the main side, by a listener that records the
 * payloads received (the renderer always calls it: drag to Finder stays wired).
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

/** Replaces main's `drag` listener with a recorder (no macOS drag session). */
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

/** `dragstart` on the card (like the real gesture: React starts `startCardDrag`). */
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

/** Hover then drop on a panel row, with a `Files` type like the native drag. */
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

test.describe('Collections panel during drag', () => {
  test.use({ demoLibrary: { count: 40, collections: 4 } })

  test('drag, drop on a collection, duplicate ignored, ⌘Z', async ({
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

    // A displayed card not yet in the collection.
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
    // Right edge, below the header.
    const box = (await panel.boundingBox())!
    const vw = await page.evaluate(() => window.innerWidth)
    expect(Math.round(box.x + box.width)).toBe(vw)
    expect(box.y).toBeGreaterThanOrEqual(80)

    await dropOnRow(page, col.uuid)
    await expect(row.locator(t('drag-collection-count'))).toHaveText(String(before + 1))
    await expect(page.getByText(`Ajouté à ${col.name}`)).toBeVisible()
    await expect.poll(members).toBe(before + 1)
    await expect(panel).toHaveCount(0)
    // The drop layer imported nothing (internal drag).
    expect(itemCount()).toBe(items)
    await expect(page.locator(t('drop-overlay'))).toHaveCount(0)

    // Second drop of the same item: nothing added, no undo entry.
    await startDrag(page, card)
    await expect(panel).toBeVisible()
    await expect(row.locator(t('drag-collection-count'))).toHaveText(String(before + 1))
    await dropOnRow(page, col.uuid)
    await expect(page.getByText(`Déjà dans ${col.name}`)).toBeVisible()
    await expect(panel).toHaveCount(0)
    expect(members()).toBe(before + 1)

    // ⌘Z: the add is undone, the collections row follows.
    expect(await clickMenu(app, 'undo')).toBe(true)
    await expect.poll(members).toBe(before)
    await expect(page.locator(`${t('collection-card')}[data-uuid="${col.uuid}"]`)).toContainText(
      before > 1 ? `${before} éléments` : `${before} élément`,
    )

    // Escape cancels a drag without a drop: the panel resets.
    await startDrag(page, card)
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    expect(members()).toBe(before)
  })
})
