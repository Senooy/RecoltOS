/**
 * M3 : capture avec le faux `screencapture` (élément, dossier de dépôt, Échap,
 * doublon, permission refusée → guide), Réglages › Capture (raccourci appliqué, conflit, réservé),
 * import (50 fichiers + 1 dossier, ⌘V image et URL), « Ouvrir avec » fenêtre fermée.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '../helpers/e2e-fixtures'
import { REPO_ROOT } from '../helpers/paths'
import { startRemoteServer } from '../helpers/remote-server'
import { makeImage } from '../helpers/synthetic-media'

const t = (id: string) => `[data-testid="${id}"]`
const FAKE = path.join(REPO_ROOT, 'tests/helpers/fake-bin/screencapture')

async function clickMenu(app: ElectronApplication, id: string): Promise<boolean> {
  return app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    if (!item) return false
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    item.click()
    return true
  }, id)
}

const setMainEnv = (app: ElectronApplication, key: string, value: string | null) =>
  app.evaluate(
    (_e, [k, v]) => {
      if (v === null) delete process.env[k]
      else process.env[k] = v
    },
    [key, value] as const,
  )

const invoke = (page: Page, channel: string, input: unknown) =>
  page.evaluate(
    ([c, i]) =>
      (
        window as unknown as { recolt: { invoke: (c: string, i: unknown) => Promise<unknown> } }
      ).recolt.invoke(c, i),
    [channel, input] as const,
  ) as Promise<{ ok: boolean; data: unknown }>

test.describe('capture', () => {
  test.use({
    demoLibrary: { count: 12, collections: 2 },
    appLaunch: {
      env: {
        RECOLTOS_SCREENCAPTURE_BIN: FAKE,
        RECOLTOS_SCREEN_ACCESS: 'granted',
        FAKE_SCREENCAPTURE_SALT: 'e2e-1',
        RECOLTOS_SHORTCUT_TAKEN: 'CommandOrControl+Shift+J',
      },
    },
  })

  test('menu « Capturer l’écran » : élément, dépôt, doublon, Échap, permission', async ({
    app,
    page,
    openDbReadonly,
  }) => {
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
    const drop = fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-drop-'))
    expect((await invoke(page, 'prefs.set', { patch: { capture: { dropFolder: drop } } })).ok).toBe(
      true,
    )
    const db = openDbReadonly()
    const captures = () =>
      (db.prepare("SELECT count(*) n FROM items WHERE source = 'capture'").get() as { n: number }).n

    expect(await clickMenu(app, 'capture')).toBe(true)
    await expect.poll(captures).toBe(1)
    await expect(page.getByText('Capture ajoutée')).toBeVisible()
    await expect
      .poll(() => fs.readdirSync(drop).filter((f) => f.startsWith('Capture RecoltOS')).length)
      .toBe(1)

    // Même image : « Déjà dans la bibliothèque », aucun nouvel élément.
    await clickMenu(app, 'capture')
    await expect(page.getByText('Déjà dans la bibliothèque')).toBeVisible()
    expect(captures()).toBe(1)

    // Échap pendant la sélection : rien.
    await setMainEnv(app, 'FAKE_SCREENCAPTURE_MODE', 'cancel')
    const r = await invoke(page, 'capture.run', {})
    expect(r.data).toEqual({ status: 'cancelled' })
    expect(captures()).toBe(1)

    // Permission refusée : guide, screencapture jamais lancé.
    const log = path.join(drop, 'calls.log')
    await setMainEnv(app, 'FAKE_SCREENCAPTURE_LOG', log)
    await setMainEnv(app, 'FAKE_SCREENCAPTURE_MODE', null)
    await setMainEnv(app, 'RECOLTOS_SCREEN_ACCESS', 'denied')
    await clickMenu(app, 'capture')
    await expect(page.locator(t('permission-guide'))).toBeVisible()
    expect(fs.existsSync(log)).toBe(false)
    expect(captures()).toBe(1)
    fs.rmSync(drop, { recursive: true, force: true })
  })

  test('Réglages › Capture : raccourci appliqué, conflit (ancien conservé), réservé', async ({
    page,
  }) => {
    await page.locator(t('btn-settings')).click()
    await page.locator(t('settings-nav-capture')).click()
    await expect(page.locator(t('capture-settings'))).toBeVisible()
    await expect(page.locator(t('shortcut-cap'))).toHaveText(['⌘', '⇧', 'S'])
    const field = await page.locator(t('drop-folder')).boundingBox()
    expect(Math.round(field!.width)).toBe(287)

    await page.locator(t('shortcut-recorder')).click()
    await page.keyboard.press('Meta+Shift+K')
    await expect(page.locator(t('shortcut-cap'))).toHaveText(['⌘', '⇧', 'K'])
    await expect
      .poll(
        async () =>
          ((await invoke(page, 'prefs.get', {})).data as { capture: { shortcut: string } }).capture
            .shortcut,
      )
      .toBe('CommandOrControl+Shift+K')

    await page.locator(t('shortcut-recorder')).click()
    await page.keyboard.press('Meta+Shift+J')
    await expect(page.locator(t('shortcut-error'))).toContainText('déjà pris')
    await expect(page.locator(t('shortcut-cap'))).toHaveText(['⌘', '⇧', 'K'])

    await page.locator(t('shortcut-recorder')).click()
    await page.keyboard.press('Meta+Shift+4')
    await expect(page.locator(t('shortcut-error'))).toContainText('réservé')
  })
})

test.describe('import', () => {
  test.use({ demoLibrary: { count: 6, collections: 1 } })

  test('50 fichiers + 1 dossier, ⌘V image et URL', async ({ app, page, openDbReadonly }) => {
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-import-'))
    const files: string[] = []
    for (let i = 0; i < 50; i++) {
      const f = path.join(dir, `img-${i}.png`)
      fs.writeFileSync(
        f,
        await makeImage({
          width: 40,
          height: 30,
          color: `#${(i * 4999 + 0x102030).toString(16).slice(-6)}`,
          format: 'png',
        }),
      )
      files.push(f)
    }
    const sub = path.join(dir, 'Dossier', 'Sous-dossier')
    fs.mkdirSync(sub, { recursive: true })
    fs.writeFileSync(
      path.join(sub, 'profond.jpg'),
      await makeImage({ width: 30, height: 30, color: '#123456', format: 'jpeg' }),
    )
    fs.writeFileSync(path.join(dir, 'Dossier', 'notes.txt'), 'ignoré')
    fs.copyFileSync(files[0]!, path.join(dir, 'Dossier', 'doublon.png'))
    const r = (await invoke(page, 'ingest.files', { paths: [...files, path.join(dir, 'Dossier')] }))
      .data as {
      added: unknown[]
      duplicates: unknown[]
      failed: unknown[]
    }
    expect(r.added).toHaveLength(51)
    expect(r.duplicates).toHaveLength(1)
    expect(r.failed).toHaveLength(0)

    const db = openDbReadonly()
    const count = () => (db.prepare('SELECT count(*) n FROM items').get() as { n: number }).n
    const before = count()

    // ⌘V d'une image (presse-papiers lu par main).
    const png = await makeImage({ width: 50, height: 50, color: '#a03050', format: 'png' })
    await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
      const buf = Buffer.from(b64, 'base64')
      await clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([new Uint8Array(buf)], { type: 'image/png' }) }),
      ])
    }, png.toString('base64'))
    await page.evaluate(() => document.dispatchEvent(new Event('paste', { bubbles: true })))
    await expect.poll(count).toBe(before + 1)

    // ⌘V d'une URL de média.
    const server = await startRemoteServer()
    try {
      await app.evaluate(
        async ({ clipboard }, u) => clipboard.writeText(u),
        server.url('/media/colle.png'),
      )
      await page.evaluate(() => document.dispatchEvent(new Event('paste', { bubbles: true })))
      await expect.poll(count).toBe(before + 2)
    } finally {
      await server.close()
    }
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('« Ouvrir avec » fenêtre fermée : fenêtre recréée, élément ouvert', async ({
    app,
    page,
  }) => {
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recolt-open-'))
    const file = path.join(dir, 'ouvert.png')
    fs.writeFileSync(
      file,
      await makeImage({ width: 64, height: 48, color: '#2266aa', format: 'png' }),
    )
    const next = app.waitForEvent('window')
    await app.evaluate(({ app: a, BrowserWindow }, f) => {
      for (const w of BrowserWindow.getAllWindows()) w.destroy()
      a.emit('open-file', { preventDefault: () => undefined }, f)
    }, file)
    const win = await next
    await expect(win.locator(t('detail'))).toBeVisible({ timeout: 15_000 })
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
