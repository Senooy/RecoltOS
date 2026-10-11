/**
 * Hôte natif (QA §4.4, PLAN §1.17-1.18) : `src/host/index.ts` → `out/host/host.js`, bundle esbuild
 * AUTONOME (CJS, builtins Node seulement, tout le reste inliné) copié seul dans
 * `Contents/Resources/native-host/`. Sans `src/host/index.ts` (avant WP-52), sort proprement.
 */
import { build } from 'esbuild'
import { existsSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')

export interface BuildHostOptions {
  root?: string
  outfile?: string
  logLevel?: 'info' | 'silent'
}

/** `require('x')` hors builtins dans le bundle : l'hôte planterait au chargement (`check-dist`). */
export function externalRequires(code: string): string[] {
  const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])
  const found = new Set<string>()
  for (const m of code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    const name = m[1] as string
    if (!builtins.has(name) && !name.startsWith('.')) found.add(name)
  }
  return [...found].sort()
}

export async function buildHost(options: BuildHostOptions = {}): Promise<string | null> {
  const root = options.root ?? ROOT
  const entry = resolve(root, 'src/host/index.ts')
  if (!existsSync(entry)) return null
  const outfile = options.outfile ?? resolve(root, 'out/host/host.js')
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22', // valide aussi sous le Node 24 d'Electron
    alias: { '@shared': resolve(root, 'src/shared') },
    legalComments: 'none',
    logLevel: options.logLevel ?? 'info',
  })
  const bad = externalRequires(readFileSync(outfile, 'utf8'))
  if (bad.length > 0) {
    throw new Error(`host.js requiert des modules hors builtins : ${bad.join(', ')}`)
  }
  return outfile
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildHost()
    .then((out) => {
      console.log(
        out
          ? `build:host : ${out}`
          : 'build:host : src/host/index.ts absent (WP-52), rien à construire',
      )
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err)
      process.exitCode = 1
    })
}
