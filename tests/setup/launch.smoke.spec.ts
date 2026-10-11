/**
 * Fumée du socle (WP-01, QA §6.3 n°1 réduit au squelette) : l'app se lance par `_electron` sur le
 * build automatique, ouvre une fenêtre 1280×820 visible, expose `window.recolt` (preload isolé) et
 * n'émet aucune erreur console (CSP comprise). Les scénarios des lots vivent sous `tests/e2e/`.
 */
import { expect, test } from '../helpers/e2e-fixtures'

test('lancement : fenêtre, window.recolt, 0 erreur console', async ({
  app,
  page,
  collectErrors,
}) => {
  // Fenêtre visible à la taille imposée par RECOLTOS_WINDOW.
  await expect(page.locator('#root > *').first()).toBeVisible()
  const win = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return w ? { visible: w.isVisible(), bounds: w.getBounds(), title: w.getTitle() } : null
  })
  expect(win).not.toBeNull()
  expect(win?.visible).toBe(true)
  expect([win?.bounds.width, win?.bounds.height]).toEqual([1280, 820])

  // Le preload expose le pont typé, et lui seul (pas de Node dans le renderer).
  const bridge = await page.evaluate(() => {
    const w = window as unknown as { recolt?: Record<string, unknown>; require?: unknown }
    return {
      type: typeof w.recolt,
      keys: Object.keys(w.recolt ?? {}).sort(),
      node: typeof w.require,
    }
  })
  expect(bridge.type).toBe('object')
  expect(bridge.keys).toEqual(expect.arrayContaining(['invoke', 'on', 'perfMark', 'startDrag']))
  expect(bridge.node).toBe('undefined')

  // Mode e2e : animations coupées (QA §2.2) et aucune erreur console jusque-là.
  await expect(page.locator('html')).toHaveAttribute('data-e2e', '1')
  // `collectErrors()` relit aussi les erreurs du chargement initial (écouteurs posés trop tard).
  expect(await collectErrors()).toEqual([])
})
