/**
 * Hôte natif : `src/host/index.ts` → `out/host/host.js`, bundle
 * esbuild AUTONOME (CJS, builtins Node seulement, tout le reste inliné), puis exécutable Node SEA
 * séparé `out/native-host/recolt-host` (blob `--experimental-sea-config` injecté par postject dans une
 * copie du binaire `node` qui exécute ce script, puis signé : `RECOLTOS_SIGN_IDENTITY` ou ad hoc).
 * L'exécutable n'est reconstruit que si `host.js` ou la version de Node changent (`.build-hash`).
 * Sans `src/host/index.ts`, sort proprement.
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { builtinModules } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')

export interface BuildHostOptions {
  root?: string
  outfile?: string
  logLevel?: 'info' | 'silent'
  /** Construit aussi l'exécutable SEA (`out/native-host/recolt-host`). */
  sea?: boolean
  /** Binaire `node` copié (défaut : celui qui exécute ce script). */
  nodeBinary?: string
}

export const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
export const SEA_NAME = 'recolt-host'

function signIdentity(): string {
  const id = (process.env.RECOLTOS_SIGN_IDENTITY ?? '').trim()
  return id === '' ? '-' : id
}

/**
 * Exécutable Node SEA à partir de `hostJs` (Node 22 : `--experimental-sea-config` + postject).
 * Rend le chemin de l'exécutable ; ne refait rien si l'empreinte n'a pas changé.
 */
export function buildSea(hostJs: string, outDir: string, nodeBinary = process.execPath): string {
  const exe = join(outDir, SEA_NAME)
  const nodeVersion = execFileSync(nodeBinary, ['--version'], { encoding: 'utf8' }).trim()
  const hash = createHash('sha256')
    .update(readFileSync(hostJs))
    .update(nodeVersion)
    .update(signIdentity())
    .digest('hex')
  const hashFile = join(outDir, '.build-hash')
  if (existsSync(exe) && existsSync(hashFile) && readFileSync(hashFile, 'utf8') === hash) return exe
  if (!readFileSync(nodeBinary).includes(SEA_FUSE)) {
    throw new Error(`${nodeBinary} ne contient pas le fusible SEA (binaire Node officiel requis)`)
  }
  mkdirSync(outDir, { recursive: true })
  const work = join(outDir, '.sea-work')
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  const blob = join(work, 'sea-prep.blob')
  const config = join(work, 'sea-config.json')
  writeFileSync(
    config,
    JSON.stringify({
      main: hostJs,
      output: blob,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    }),
  )
  execFileSync(nodeBinary, ['--experimental-sea-config', config], { stdio: 'pipe' })
  rmSync(exe, { force: true })
  copyFileSync(nodeBinary, exe)
  chmodSync(exe, 0o755)
  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--remove-signature', exe], { stdio: 'pipe' })
  }
  const postject = resolve(import.meta.dirname, '../node_modules/postject/dist/cli.js')
  const args = [postject, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', SEA_FUSE]
  if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA')
  execFileSync(nodeBinary, args, { stdio: 'pipe' })
  if (process.platform === 'darwin') {
    execFileSync('codesign', ['--sign', signIdentity(), '--force', exe], { stdio: 'pipe' })
  }
  rmSync(work, { recursive: true, force: true })
  writeFileSync(hashFile, hash)
  return exe
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
  if (options.sea) buildSea(outfile, resolve(root, 'out/native-host'), options.nodeBinary)
  return outfile
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildHost({ sea: !process.argv.includes('--no-sea') })
    .then((out) => {
      console.log(
        out ? `build:host : ${out}` : 'build:host : src/host/index.ts absent, rien à construire',
      )
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err)
      process.exitCode = 1
    })
}
