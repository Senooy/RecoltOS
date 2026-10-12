/**
 * Signing the Firefox extension: `web-ext sign --channel unlisted` on
 * `dist-extension/firefox/`, output in `dist-extension/signed/*.xpi`. AMO API keys are read
 * from `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET`, provided by the user themselves: this script
 * never displays, asks for, nor saves them. Each submission to AMO requires a bumped
 * version (`EXTENSION_VERSION`).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const src = join(ROOT, 'dist-extension/firefox')
if (!existsSync(join(src, 'manifest.json'))) {
  console.error('sign:firefox: run `pnpm run build:ext` first.')
  process.exit(1)
}
if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
  console.error(
    'sign:firefox: set WEB_EXT_API_KEY and WEB_EXT_API_SECRET (API credentials of your ' +
      'addons.mozilla.org account, see docs/extension.md), then run again.',
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
