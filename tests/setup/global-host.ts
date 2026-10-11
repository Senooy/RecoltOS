/**
 * `globalSetup` du projet `unit` : construit l'hôte natif de test dans `.tmp/host-test/host.js`
 * (quelques ms) quand `src/host/index.ts` existe (WP-52). Sans hôte : no-op.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { purgeStaleTmpDirs } from '../helpers/tmpdir'

export default async function setup(): Promise<void> {
  // Restes d'exécutions précédentes interrompues (`.tmp/tests/`, > 10 min).
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
