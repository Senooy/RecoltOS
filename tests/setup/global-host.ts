/**
 * `globalSetup` of the `unit` project: builds the native test host into `.tmp/host-test/host.js`
 * (a few ms) when `src/host/index.ts` exists. Without a host: no-op.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { purgeStaleTmpDirs } from '../helpers/tmpdir'

export default async function setup(): Promise<void> {
  // Leftovers from previous interrupted runs (`.tmp/tests/`, > 10 min).
  purgeStaleTmpDirs()
  const root = resolve(import.meta.dirname, '../..')
  const entry = resolve(root, 'src/host/index.ts')
  if (!existsSync(entry)) return
  const { build } = await import('esbuild')
  await build({
    entryPoints: [entry],
    outfile: resolve(root, '.tmp/host-test/host.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    alias: { '@shared': resolve(root, 'src/shared') },
    legalComments: 'none',
    logLevel: 'silent',
  })
}
