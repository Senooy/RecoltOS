/**
 * Interface en anglais : réglage `ui.language: 'en'` (le système simulé reste en français, le
 * réglage prime). Aucun texte français sur la Bibliothèque ni dans les sections des Réglages
 * (texte visible, `aria-label`, `title`, `placeholder`), menu natif en anglais, puis bascule à chaud
 * vers le français et retour depuis Réglages › Apparence, sans redémarrage.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { launchApp } from '../helpers/electron-app'
import { makeTmpDir, removeTmpDir } from '../helpers/tmpdir'

/** Lettres accentuées et mots d'interface français (hors « Français » du sélecteur de langue). */
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

test('anglais : Bibliothèque et Réglages sans texte français, bascule à chaud', async () => {
  test.setTimeout(90_000)
  const userData = makeTmpDir('userdata-en')
  writeFileSync(join(userData, 'prefs.json'), JSON.stringify({ ui: { language: 'en' } }))
  const handle = await launchApp({ userData })
  try {
    const { app, page } = handle
    await expect(page.locator('[data-testid="seg-library"]')).toHaveText(/Library/)
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('en')
    // Bibliothèque montée (onglets, état vide) avant de relire les textes.
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

    // Bascule à chaud : Réglages › Apparence › Langue, la modale reste ouverte.
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
