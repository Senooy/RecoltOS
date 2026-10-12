/**
 * M2 : Réglages › Données (export zip, instantané, restauration), Tags, Stockage,
 * Apparence (thème immédiat + nativeTheme, colonnes par défaut appliquées à la grille).
 */
import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '../helpers/e2e-fixtures'
import { makeTmpDir } from '../helpers/tmpdir'

const t = (id: string) => `[data-testid="${id}"]`

async function openSettings(page: Page, section: string) {
  await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
  await page.locator(t('btn-settings')).click()
  await page.locator(t(`settings-nav-${section}`)).click()
  await expect(page.locator(t(`settings-section-${section}`))).toBeVisible()
}

/** Le dialogue d'enregistrement natif est remplacé par un chemin fixé (main). */
async function stubSaveDialog(app: ElectronApplication, file: string) {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: target })
  }, file)
}

test.describe('Réglages › Données, Tags, Apparence', () => {
  test.use({ demoLibrary: { count: 60, collections: 6 } })

  test('export zip valide puis instantané et restauration', async ({
    app,
    page,
    userData,
    openDbReadonly,
  }) => {
    const outDir = makeTmpDir('export')
    const out = join(outDir, 'export-e2e.zip')
    await stubSaveDialog(app, out)
    await openSettings(page, 'data')
    await page.locator(t('data-export')).click()
    await expect.poll(() => existsSync(out), { timeout: 30_000 }).toBe(true)
    await expect.poll(() => statSync(out).size, { timeout: 30_000 }).toBeGreaterThan(1000)
    execFileSync('unzip', ['-tq', out])
    const jsonl = execFileSync('unzip', ['-p', out, 'metadata/items.jsonl'], { encoding: 'utf8' })
    const db = openDbReadonly()
    const total = (db.prepare('SELECT count(*) n FROM items').get() as { n: number }).n
    expect(jsonl.trim().split('\n')).toHaveLength(total)

    // Instantané, puis une écriture, puis restauration : l'écriture disparaît.
    await page.locator(t('data-snapshot')).click()
    await expect(page.locator(t('snapshot-row'))).toHaveCount(1)
    await page.evaluate(() =>
      window.recolt!.invoke('collections.create', { name: 'Après instantané' }),
    )
    await expect
      .poll(() =>
        db.prepare("SELECT count(*) n FROM collections WHERE name = 'Après instantané'").get(),
      )
      .toEqual({ n: 1 })
    db.close()
    await page.locator(t('snapshot-restore')).first().click()
    await page.locator(t('app-dialog')).getByRole('button', { name: 'Restaurer' }).click()
    await expect(page.getByText('Instantané restauré')).toBeVisible({ timeout: 20_000 })
    const libDir = join(userData, 'libraries', 'default')
    const fresh = new Database(join(libDir, 'recolt.db'), { readonly: true })
    expect(
      fresh.prepare("SELECT count(*) n FROM collections WHERE name = 'Après instantané'").get(),
    ).toEqual({ n: 0 })
    fresh.close()
    const pre = readdirSync(join(libDir, 'snapshots')).find((f) => /-pre-restore\.db$/.test(f))
    expect(pre).toBeTruthy()
    const preDb = new Database(join(libDir, 'snapshots', pre!), { readonly: true })
    expect(
      preDb.prepare("SELECT count(*) n FROM collections WHERE name = 'Après instantané'").get(),
    ).toEqual({ n: 1 })
    preDb.close()
    // L'app est restée utilisable.
    await page.keyboard.press('Escape')
    await expect(page.locator(`${t('grid')} ${t('card')}`).first()).toBeVisible()
  })

  test('tags : création, renommage en ligne, fusion, suppression', async ({
    page,
    openDbReadonly,
  }) => {
    await openSettings(page, 'tags')
    const create = async (name: string) => {
      await page.locator(t('settings-tag-new')).click()
      await page.locator(`${t('app-dialog')} input`).fill(name)
      await page.keyboard.press('Enter')
      await expect(page.locator(t('settings-tag-row'), { hasText: name })).toBeVisible()
    }
    await create('aube')
    await create('crepuscule')
    const row = page.locator(t('settings-tag-row'), { hasText: 'aube' })
    await row.getByRole('button', { name: 'aube', exact: true }).click()
    await page.locator(t('settings-tag-input')).fill('aurore')
    await page.keyboard.press('Enter')
    await expect(page.locator(t('settings-tag-row'), { hasText: 'aurore' })).toBeVisible()
    // Fusion « crepuscule » → « aurore ».
    await page
      .locator(t('settings-tag-row'), { hasText: 'crepuscule' })
      .getByRole('button', { name: /Actions du tag/ })
      .click()
    await page.getByRole('menuitem', { name: 'Fusionner avec…' }).click()
    await page.getByRole('menuitem', { name: '#aurore' }).click()
    await expect(page.locator(t('settings-tag-row'), { hasText: 'crepuscule' })).toHaveCount(0)
    const db = openDbReadonly()
    expect(
      db.prepare("SELECT count(*) n FROM tags WHERE name IN ('aube','crepuscule')").get(),
    ).toEqual({ n: 0 })
    // Suppression.
    await page
      .locator(t('settings-tag-row'), { hasText: 'aurore' })
      .getByRole('button', { name: /Actions du tag/ })
      .click()
    await page.getByRole('menuitem', { name: 'Supprimer' }).click()
    await page.locator(t('app-dialog')).getByRole('button', { name: 'Supprimer' }).click()
    await expect(page.locator(t('settings-tag-row'), { hasText: 'aurore' })).toHaveCount(0)
  })

  test('apparence : thème immédiat + nativeTheme ; stockage : médias distants', async ({
    app,
    page,
  }) => {
    await openSettings(page, 'appearance')
    await page.getByRole('radio', { name: 'Sombre' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
    await page.getByRole('radio', { name: 'Clair' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.locator(t('settings-nav-storage')).click()
    const sw = page.locator(t('pref-download-remote'))
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator(t('storage-bar'))).toContainText('Images')
  })
})
