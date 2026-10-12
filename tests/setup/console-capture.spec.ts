/**
 * Preuve que le critère « 0 erreur console » n'est pas faillible : une violation CSP
 * émise PENDANT le chargement initial doit être vue à chaque lancement, et pas seulement quand les
 * écouteurs posés après `electron.launch()` arrivent à temps (course mesurée : 1 fois sur 3).
 * L'app est lancée depuis une copie de `out/` dont `index.html` embarque un script inline (interdit
 * par la CSP `script-src 'self'`).
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

test('une violation CSP au chargement est vue à chaque lancement', async () => {
  expect(existsSync(join(REPO_ROOT, 'out/main/index.js'))).toBe(true)
  const root = poisonedRoot()
  for (let i = 0; i < 3; i++) {
    const handle = await launchApp({ root })
    try {
      const errors = await handle.flushErrors()
      expect(errors.join('\n'), `lancement ${i + 1}`).toMatch(/Content Security Policy/)
      // Sans doublon, même si l'écouteur en direct l'a aussi vue.
      expect(new Set(errors).size).toBe(errors.length)
    } finally {
      await handle.close()
    }
  }
})

test('app saine : flushErrors ne renvoie rien', async () => {
  const handle = await launchApp()
  try {
    await handle.page.locator('#root > *').first().waitFor()
    expect(await handle.flushErrors()).toEqual([])
  } finally {
    await handle.close()
  }
})
