/**
 * Foundation smoke test (reduced to the skeleton): the app launches via `_electron` on the
 * automatic build, opens a visible 1280×820 window, exposes `window.recolt` (isolated preload) and
 * emits no console error (CSP included). Scenarios live under `tests/e2e/`.
 */
import { expect, test } from '../helpers/e2e-fixtures'

test('launch: window, window.recolt, 0 console errors', async ({ app, page, collectErrors }) => {
  // Window visible at the size set by RECOLTOS_WINDOW.
  await expect(page.locator('#root > *').first()).toBeVisible()
  const win = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return w ? { visible: w.isVisible(), bounds: w.getBounds(), title: w.getTitle() } : null
  })
  expect(win).not.toBeNull()
  expect(win?.visible).toBe(true)
  expect([win?.bounds.width, win?.bounds.height]).toEqual([1280, 820])

  // The preload exposes the typed bridge, and only it (no Node in the renderer).
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

  // e2e mode: animations disabled and no console error up to that point.
  await expect(page.locator('html')).toHaveAttribute('data-e2e', '1')
  // `collectErrors()` also re-reads the errors from the initial load (listeners attached too late).
  expect(await collectErrors()).toEqual([])
})
