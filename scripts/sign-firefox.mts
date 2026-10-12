/**
 * Signature de l'extension Firefox : `web-ext sign --channel unlisted` sur
 * `dist-extension/firefox/`, résultat dans `dist-extension/signed/*.xpi`. Les clés d'API AMO sont lues
 * dans `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET`, fournies par l'utilisateur lui-même : ce script ne
 * les affiche, ne les demande ni ne les enregistre jamais. Chaque envoi à AMO exige une version
 * nouvelle (`EXTENSION_VERSION`).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const src = join(ROOT, 'dist-extension/firefox')
if (!existsSync(join(src, 'manifest.json'))) {
  console.error('sign:firefox : lance d’abord `pnpm run build:ext`.')
  process.exit(1)
}
if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
  console.error(
    'sign:firefox : définis WEB_EXT_API_KEY et WEB_EXT_API_SECRET (identifiants d’API de ton compte ' +
      'addons.mozilla.org, voir docs/extension.md), puis relance.',
  )
  process.exit(2)
}
const r = spawnSync(
  join(ROOT, 'node_modules/.bin/web-ext'),
  [
    'sign',
    '--source-dir',
    src,
    '--artifacts-dir',
    join(ROOT, 'dist-extension/signed'),
    '--channel',
    'unlisted',
    '--no-input',
  ],
  { stdio: 'inherit', env: process.env },
)
process.exit(r.status ?? 1)
