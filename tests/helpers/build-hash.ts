/**
 * Empreinte des sources qui déterminent `out/` : `src/**`, `extension/**`,
 * `electron.vite.config.ts`, `package.json`, `pnpm-lock.yaml`. Comparée à `out/.build-hash` par
 * le projet Playwright `build` pour ne reconstruire que si nécessaire.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export const BUILD_INPUT_DIRS = ['src', 'extension'] as const
export const BUILD_INPUT_FILES = [
  'electron.vite.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.base.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
] as const

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === '.DS_Store') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else yield p
  }
}

export function listBuildInputs(root: string): string[] {
  const files: string[] = []
  for (const d of BUILD_INPUT_DIRS) files.push(...walk(join(root, d)))
  for (const f of BUILD_INPUT_FILES) if (existsSync(join(root, f))) files.push(join(root, f))
  return files
}

export function computeBuildHash(root: string): string {
  const h = createHash('sha256')
  for (const f of listBuildInputs(root)) {
    h.update(relative(root, f))
    h.update('\0')
    h.update(readFileSync(f))
    h.update('\0')
  }
  return h.digest('hex')
}
