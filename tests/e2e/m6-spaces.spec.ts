/**
 * M6: empty state → create a space; note (N tool), undo / redo,
 * dragging a thumbnail from the drawer, reload → persistence; 3 files dropped → 3 image nodes;
 * edit a note then close the window IMMEDIATELY → text in the DB and after reopening; 3,000
 * nodes moved then reloaded, 1 invalid node isolated with a toast; paste a note containing a
 * URL → a note; « Ajouter à un space › » updates the list thumbnail; PNG export.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '../helpers/e2e-fixtures'
import { makeImage } from '../helpers/synthetic-media'

const t = (id: string) => `[data-testid="${id}"]`

interface SpacesHook {
  useSpace: {
    getState(): { selection: string[]; nodes: Record<string, { uuid: string; width: number }> }
    setState(p: unknown): void
  }
  persistence: { mark(ids: string[]): void }
}

const invoke = <T = unknown>(page: Page, channel: string, input?: unknown) =>
  page.evaluate(
    ([c, i]) =>
      (
        window as unknown as { recolt: { invoke: (c: string, i: unknown) => Promise<unknown> } }
      ).recolt.invoke(c, i),
    [channel, input] as const,
  ) as Promise<{ ok: boolean; data: T; error?: { code: string; message: string } }>

async function createSpaceViaCta(page: Page): Promise<string> {
  await page.locator(t('seg-spaces')).click()
  await expect(page.locator(t('space-empty-cta'))).toBeVisible()
  await page.locator(t('space-empty-cta')).click()
  await expect(page.locator(t('space-viewport'))).toBeVisible()
  // The title is in edit mode: name it.
  const input = page.locator(t('collection-title-input'))
  await expect(input).toBeVisible()
  await input.fill('Moodboard')
  await input.press('Enter')
  const list = await invoke<{ uuid: string; name: string }[]>(page, 'spaces.list')
  await expect
    .poll(async () => (await invoke<{ name: string }[]>(page, 'spaces.list')).data[0]?.name)
    .toBe('Moodboard')
  return list.data[0]!.uuid
}

async function viewportCenter(page: Page) {
  const box = (await page.locator(t('space-viewport')).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box }
}

async function dbNodes(app: ElectronApplication, page: Page, uuid: string) {
  void app
  const r = await invoke<{ nodes: { uuid: string; type: string; content?: string; x: number }[] }>(
    page,
    'spaces.get',
    { uuid },
  )
  return r.data.nodes
}

test.describe('spaces', () => {
  test.use({ demoLibrary: { count: 12, collections: 2 } })

  test('create, note, undo/redo, drawer, reload, dropped files', async ({ app, page }) => {
    const uuid = await createSpaceViaCta(page)
    const c = await viewportCenter(page)

    // Note: N tool then click; type; click on empty space to confirm.
    await page.keyboard.press('n')
    await page.mouse.click(c.x - 200, c.y - 100)
    const editor = page.locator(t('note-editor'))
    await expect(editor).toBeVisible()
    await editor.fill('Idée de couverture')
    await page.mouse.click(c.x + 250, c.y + 150)
    await expect(page.locator('.space-node[data-type="note"]')).toContainText('Idée de couverture')
    await expect.poll(async () => (await dbNodes(app, page, uuid)).length).toBe(1)

    // Undo the typing, then the creation; redo.
    await page.keyboard.press('Meta+z')
    await expect(page.locator('.space-node[data-type="note"]')).not.toContainText('Idée')
    await page.keyboard.press('Meta+z')
    await expect(page.locator('.space-node[data-type="note"]')).toHaveCount(0)
    await page.keyboard.press('Meta+Shift+z')
    await page.keyboard.press('Meta+Shift+z')
    await expect(page.locator('.space-node[data-type="note"]')).toContainText('Idée de couverture')

    // Drawer: drag a thumbnail onto the canvas (DnD simulated with the internal type).
    await page.locator(t('tool-library')).click()
    const card = page.locator(t('drawer-card')).first()
    await expect(card).toBeVisible()
    const itemUuid = await card.getAttribute('data-uuid')
    await page.evaluate(
      ([u, x, y]) => {
        const dt = new DataTransfer()
        dt.setData('application/x-recoltos-items', JSON.stringify([u]))
        const target = document.querySelector('[data-testid="space-editor"]')!
        for (const type of ['dragover', 'drop']) {
          target.dispatchEvent(
            new DragEvent(type, {
              dataTransfer: dt,
              clientX: x,
              clientY: y,
              bubbles: true,
              cancelable: true,
            }),
          )
        }
      },
      [itemUuid!, c.x - 300, c.y] as const,
    )
    await expect(page.locator('.space-node[data-type="item"]')).toHaveCount(1)
    await expect(page.locator(`${t('drawer-card')}[data-uuid="${itemUuid}"]`)).toHaveAttribute(
      'data-present',
      '1',
    )

    // 3 files dropped from "another browser" (no path) → 3 image nodes.
    const pngs = await Promise.all(
      ['#d23c28', '#1e5aa0', '#28a050'].map(async (color) =>
        (await makeImage({ width: 120, height: 80, color, format: 'png' })).toString('base64'),
      ),
    )
    await page.evaluate(
      ([files, x, y]) => {
        const dt = new DataTransfer()
        files.forEach((b64, i) => {
          const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
          dt.items.add(new File([bin], `image-${i}.png`, { type: 'image/png' }))
        })
        const target = document.querySelector('[data-testid="space-editor"]')!
        for (const type of ['dragover', 'drop']) {
          target.dispatchEvent(
            new DragEvent(type, {
              dataTransfer: dt,
              clientX: x,
              clientY: y,
              bubbles: true,
              cancelable: true,
            }),
          )
        }
      },
      [pngs, c.x + 100, c.y + 100] as const,
    )
    await expect(page.locator('.space-node[data-type="image"]')).toHaveCount(3)
    await expect.poll(async () => (await dbNodes(app, page, uuid)).length).toBe(5)

    // Reload the window: everything is still there.
    await page.reload()
    await page.locator(t('seg-spaces')).click()
    await expect(page.locator(t('space-card'))).toHaveCount(1)
    await expect(page.locator(t('space-card')).locator('.space-node')).toHaveCount(5)
    await page.locator(t('space-card')).click()
    await expect(page.locator(`${t('space-world')} .space-node`)).toHaveCount(5)
    await expect(page.locator('.space-node[data-type="note"]')).toContainText('Idée de couverture')
  })

  test('edit a note then close the window right away: text kept', async ({ app, page }) => {
    const uuid = await createSpaceViaCta(page)
    const c = await viewportCenter(page)
    await page.keyboard.press('n')
    await page.mouse.click(c.x, c.y)
    await page.locator(t('note-editor')).pressSequentially('Ne pas perdre ce texte')
    // Immediate close (⌘W / red button), without leaving edit mode.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
    await expect.poll(() => app.windows().length).toBe(0)
    const win = app.waitForEvent('window')
    await app.evaluate(({ app: a }) => a.emit('activate'))
    const page2 = await win
    await page2.waitForLoadState('domcontentloaded')
    await expect
      .poll(async () => {
        const r = await invoke<{ nodes: { content?: string }[] }>(page2, 'spaces.get', {
          uuid,
        }).catch(() => null)
        return r?.data?.nodes?.[0]?.content ?? null
      })
      .toBe('Ne pas perdre ce texte')
    await page2.locator(t('seg-spaces')).click()
    await page2.locator(t('space-card')).click()
    await expect(page2.locator('.space-node[data-type="note"]')).toContainText(
      'Ne pas perdre ce texte',
    )
  })

  test('3,000 nodes moved then reloaded; 1 invalid node isolated', async ({ page }) => {
    test.setTimeout(120_000)
    const created = await invoke<{ uuid: string }>(page, 'spaces.create', { name: 'Gros' })
    const uuid = created.data.uuid
    const now = Date.now()
    const nodes = Array.from({ length: 3000 }, (_, i) => ({
      uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      type: 'note',
      x: (i % 60) * 220,
      y: Math.floor(i / 60) * 220,
      width: 200,
      height: 200,
      rotation: 0,
      z: i,
      locked: false,
      createdAt: now,
      updatedAt: now,
      content: `n${i}`,
      style: { color: 'yellow', fontSize: 14, align: 'left' },
    }))
    for (let i = 0; i < nodes.length; i += 2000) {
      const r = await invoke(page, 'spaces.applyBatch', {
        spaceUuid: uuid,
        upsert: nodes.slice(i, i + 2000),
        delete: [],
      })
      expect(r.ok).toBe(true)
    }
    await page.locator(t('seg-spaces')).click()
    await page.locator(t('space-card')).click()
    await expect(page.locator(t('space-viewport'))).toBeVisible()
    await page.locator(t('space-viewport')).click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Meta+a')
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __recoltSpaces: SpacesHook }).__recoltSpaces.useSpace.getState()
              .selection.length,
        ),
      )
      .toBe(3000)
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('ArrowDown')
    // An invalid node (width < 24) injected outside the app's paths: rejected by main.
    await page.evaluate(() => {
      const s = (window as unknown as { __recoltSpaces: SpacesHook }).__recoltSpaces
      const st = s.useSpace.getState()
      const bad = {
        ...st.nodes['00000000-0000-4000-8000-000000000000'],
        uuid: '00000000-0000-4000-8000-999999999999',
        width: 10,
      }
      s.useSpace.setState({ nodes: { ...st.nodes, [bad.uuid]: bad } })
      s.persistence.mark([bad.uuid])
    })
    await expect(page.getByText('1 élément invalide ignoré')).toBeVisible({ timeout: 15_000 })
    await page.reload()
    const r = await invoke<{ nodes: { uuid: string; x: number; y: number }[] }>(
      page,
      'spaces.get',
      { uuid },
    )
    expect(r.data.nodes).toHaveLength(3000)
    const byId = new Map(r.data.nodes.map((n) => [n.uuid, n]))
    for (const n of nodes) {
      const m = byId.get(n.uuid)!
      expect(m.x).toBe(n.x + 10)
      expect(m.y).toBe(n.y + 1)
    }
  })

  test('pasting a note containing a URL pastes a note; add to a space from the grid', async ({
    app,
    page,
  }) => {
    const uuid = await createSpaceViaCta(page)
    const c = await viewportCenter(page)
    await page.keyboard.press('n')
    await page.mouse.click(c.x, c.y)
    await page.locator(t('note-editor')).fill('https://exemple.fr/article')
    await page.mouse.click(c.x + 300, c.y + 200)
    await page.locator('.space-node[data-type="note"]').click()
    const readText = () => app.evaluate(({ clipboard }) => clipboard.readText())
    const saved = await readText()
    await page.keyboard.press('Meta+c')
    await expect.poll(readText).toContain('exemple.fr')
    await page.keyboard.press('Meta+v')
    await expect(page.locator('.space-node[data-type="note"]')).toHaveCount(2)
    await expect(page.locator('.space-node[data-type="text"]')).toHaveCount(0)
    await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), saved)

    // « Ajouter à un space › » from the grid: the list thumbnail reflects the addition.
    await page.locator(t('seg-library')).click()
    const card = page.locator(`${t('grid')} ${t('card')}`).first()
    await card.click({ button: 'right' })
    await page.locator(t('menu-add-to-space')).click()
    await page.locator(`${t('menu-space')}[data-uuid="${uuid}"]`).click()
    await expect(page.getByText(/ajouté à « Moodboard »/)).toBeVisible()
    await page.locator(t('seg-spaces')).click()
    await expect(
      page.locator(t('space-card')).locator('.space-node[data-type="item"]'),
    ).toHaveCount(1)
  })

  test('valid PNG export (signature, dimensions)', async ({ app, page }) => {
    test.setTimeout(90_000)
    const created = await invoke<{ uuid: string }>(page, 'spaces.create', { name: 'Export' })
    const uuid = created.data.uuid
    const now = Date.now()
    const mk = (i: number, x: number, y: number, color: string) => ({
      uuid: `00000000-0000-4000-8000-00000000010${i}`,
      type: 'note',
      x,
      y,
      width: 200,
      height: 200,
      rotation: 0,
      z: i,
      locked: false,
      createdAt: now,
      updatedAt: now,
      content: `Note ${i}`,
      style: { color, fontSize: 14, align: 'left' },
    })
    await invoke(page, 'spaces.applyBatch', {
      spaceUuid: uuid,
      upsert: [mk(1, 0, 0, 'yellow'), mk(2, 1400, 900, 'blue')],
      delete: [],
    })
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-export-')), 'export.png')
    await app.evaluate(({ dialog }, file) => {
      ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = () =>
        Promise.resolve({ canceled: false, filePath: file })
    }, out)
    const r = await invoke<{ path: string }>(page, 'spaces.exportPng', {
      uuid,
      scope: 'all',
      scale: 1,
      background: 'light',
      name: 'Export',
    })
    expect(r.ok, r.error?.message).toBe(true)
    const buf = fs.readFileSync(out)
    expect(buf.subarray(0, 4).toString('hex')).toBe('89504e47')
    // 1,600 × 1,100 world units + 2 × 48 margin, at scale 1.
    expect(buf.readUInt32BE(16)).toBe(1600 + 96)
    expect(buf.readUInt32BE(20)).toBe(1100 + 96)
    fs.rmSync(path.dirname(out), { recursive: true, force: true })
  })
})
