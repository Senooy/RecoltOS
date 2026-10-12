/**
 * English UI: `ui.language: 'en'` setting (the simulated system stays in French, the
 * setting wins). No French text on the Library nor in the Settings sections
 * (visible text, `aria-label`, `title`, `placeholder`), native menu in English, then hot switch
 * to French and back from Settings › Appearance, without restart.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { launchApp } from '../helpers/electron-app'
import { makeTmpDir, removeTmpDir } from '../helpers/tmpdir'

/** Accented letters and French UI words (except "Français" in the language selector). */
const FRENCH =
  /[àâçéèêëîïôûùœ«»]| [:;?!](\s|$)|\b(Bibliothèques?|Réglages|Corbeille|Masqués|Enregistrés|Non classés|Tout|Rechercher|Ajouter|Apparence|Thème|Stockage|Données|Fermer|Langue|Synchronisation|Importer|Créer|Supprimer|Ouvrir|Vider|Aucun|Aucune|Tes|Ton|Ta)\b/

async function visibleTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>()
    for (const line of document.body.innerText.split('\n')) if (line.trim()) out.add(line.trim())
    for (const el of document.querySelectorAll('[aria-label],[title],[placeholder]')) {
      for (const a of ['aria-label', 'title', 'placeholder']) {
        const v = el.getAttribute(a)
        if (v?.trim()) out.add(v.trim())
      }
    }
    return [...out]
  })
}

function frenchIn(texts: string[]): string[] {
  return texts.filter((t) => t !== 'Français' && FRENCH.test(t))
}

const menuLabels = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label))

test('English: Library and Settings without French text, hot switch', async () => {
  test.setTimeout(90_000)
  const userData = makeTmpDir('userdata-en')
  writeFileSync(join(userData, 'prefs.json'), JSON.stringify({ ui: { language: 'en' } }))
  const handle = await launchApp({ userData })
  try {
    const { app, page } = handle
    await expect(page.locator('[data-testid="seg-library"]')).toHaveText(/Library/)
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en')
    // Library mounted (tabs, empty state) before re-reading the texts.
    await expect(page.getByRole('tablist')).toBeVisible()
    await expect(page.getByText('Your library is empty')).toBeVisible()
    expect(frenchIn(await visibleTexts(page))).toEqual([])
    expect(await menuLabels(app)).toEqual(['RecoltOS', 'File', 'Edit', 'View', 'Window', 'Help'])

    await page.locator('[data-testid="btn-settings"]').click()
    await expect(page.locator('[data-testid="settings"]')).toBeVisible()
    for (const section of [
      'appearance',
      'libraries',
      'ai',
      'tags',
      'capture',
      'sync',
      'storage',
      'data',
      'about',
    ]) {
      await page.locator(`[data-testid="settings-nav-${section}"]`).click()
      await page.waitForTimeout(150)
      const found = frenchIn(await visibleTexts(page))
      expect(found, `Réglages › ${section}`).toEqual([])
    }

    // Hot switch: Settings › Appearance › Language, the modal stays open.
    await page.locator('[data-testid="settings-nav-appearance"]').click()
    const select = page.locator('[data-testid="settings-language"]')
    await expect(select).toHaveValue('en')
    await select.selectOption('fr')
    await expect(page.locator('[data-testid="settings-nav-appearance"]')).toHaveText(/Apparence/)
    await expect(page.locator('[data-testid="settings"]')).toBeVisible()
    await expect.poll(() => menuLabels(app)).toContain('Fichier')
    await page.locator('[data-testid="settings-language"]').selectOption('en')
    await expect(page.locator('[data-testid="settings-nav-appearance"]')).toHaveText(/Appearance/)
    await expect.poll(() => menuLabels(app)).toContain('File')
    expect(await handle.flushErrors()).toEqual([])
  } finally {
    await handle.close()
    removeTmpDir(userData)
  }
})
