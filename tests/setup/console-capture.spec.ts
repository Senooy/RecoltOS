/**
 * Proof that the "0 console errors" criterion is not fallible: a CSP violation
 * emitted DURING the initial load must be seen at every launch, not only when the
 * listeners set after `electron.launch()` arrive in time (measured race: 1 time in 3).
 * The app is launched from a copy of `out/` whose `index.html` embeds an inline script (forbidden
 * by the CSP `script-src 'self'`).
 */
import { cpSync, existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from '../helpers/electron-app'
import { REPO_ROOT } from '../helpers/paths'
import { makeTmpDir } from '../helpers/tmpdir'

function poisonedRoot(): string {
  const root = makeTmpDir('poisoned-root')
  cpSync(join(REPO_ROOT, 'package.json'), join(root, 'package.json'))
  cpSync(join(REPO_ROOT, 'out'), join(root, 'out'), { recursive: true })
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'))
  const html = join(root, 'out/renderer/index.html')
  const src = readFileSync(html, 'utf8')
  expect(src).toContain('<title>')
  writeFileSync(html, src.replace('<title>', "<script>console.error('inline')</script><title>"))
  return root
}

test('a CSP violation on load is seen at every launch', async () => {
  expect(existsSync(join(REPO_ROOT, 'out/main/index.js'))).toBe(true)
  const root = poisonedRoot()
  for (let i = 0; i < 3; i++) {
    const handle = await launchApp({ root })
    try {
      const errors = await handle.flushErrors()
      expect(errors.join('\n'), `lancement ${i + 1}`).toMatch(/Content Security Policy/)
      // No duplicate, even if the live listener also saw it.
      expect(new Set(errors).size).toBe(errors.length)
    } finally {
      await handle.close()
    }
  }
})

test('healthy app: flushErrors returns nothing', async () => {
  const handle = await launchApp()
  try {
    await handle.page.locator('#root > *').first().waitFor()
    expect(await handle.flushErrors()).toEqual([])
  } finally {
    await handle.close()
  }
})
