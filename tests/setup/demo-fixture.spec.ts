/**
 * `demoLibrary` e2e fixture + `openDbReadonly()` and import of the helpers under Playwright (CJS):
 * the `../helpers` barrel and `demo-library` must load without `import.meta`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FAKE_BIN_DIR, REPO_ROOT, makeDemoLibrary } from '../helpers'
import { expect, test } from '../helpers/e2e-fixtures'

test('the helpers barrel loads under Playwright (CJS)', () => {
  expect(FAKE_BIN_DIR).toBe(join(REPO_ROOT, 'tests/helpers/fake-bin'))
  expect(existsSync(FAKE_BIN_DIR)).toBe(true)
  expect(typeof makeDemoLibrary).toBe('function')
})

test.describe('demo library', () => {
  test.use({ demoLibrary: { count: 20, collections: 3 } })

  test('pre-filled userData and database reread read-only', async ({
    page,
    userData,
    openDbReadonly,
    collectErrors,
  }) => {
    expect(existsSync(join(userData, 'libraries.json'))).toBe(true)
    await expect(page.locator('#root > *').first()).toBeVisible()
    const db = openDbReadonly()
    expect((db.prepare('SELECT count(*) n FROM items').get() as { n: number }).n).toBe(20)
    expect((db.prepare('SELECT count(*) n FROM collections').get() as { n: number }).n).toBe(3)
    expect(() => db.exec('DELETE FROM items')).toThrow(/readonly/i)
    expect(await collectErrors()).toEqual([])
  })
})
