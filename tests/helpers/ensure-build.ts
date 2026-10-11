/**
 * Construit `out/` quand les sources ont changé depuis `out/.build-hash` (ou si `RECOLTOS_REBUILD=1`).
 * Partagé par le projet Playwright `build` et par `scripts/visual/shots.mts`. Les builds passent par
 * `process.execPath` (jamais de pnpm imbriqué : il repasserait par le PATH et corepack).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeBuildHash } from './build-hash'
import { REPO_ROOT } from './paths'

function run(root: string, label: string, args: string[], env: NodeJS.ProcessEnv = {}): void {
  const r = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 300_000,
  })
  if (r.status !== 0) {
    throw new Error(`${label} a échoué (code ${r.status}) :\n${r.stdout}\n${r.stderr}`)
  }
}

export function isBuildComplete(root: string): boolean {
  return ['main/index.js', 'preload/index.js', 'renderer/index.html'].every((f) =>
    existsSync(join(root, 'out', f)),
  )
}

/** Renvoie `true` si un build a eu lieu. */
export function ensureBuild(root: string = REPO_ROOT): boolean {
  const out = join(root, 'out')
  const hashFile = join(out, '.build-hash')
  const hash = computeBuildHash(root)
  const previous = existsSync(hashFile) ? readFileSync(hashFile, 'utf8').trim() : ''
  if (previous === hash && isBuildComplete(root) && process.env.RECOLTOS_REBUILD !== '1') {
    return false
  }
  run(root, 'electron-vite build', [
    join(root, 'node_modules/electron-vite/bin/electron-vite.js'),
    'build',
  ])
  if (existsSync(join(root, 'src/host/index.ts'))) {
    run(root, 'build-host', ['--import', 'tsx', 'scripts/build-host.mts'], {
      TSX_TSCONFIG_PATH: 'tsconfig.node.json',
    })
  }
  mkdirSync(out, { recursive: true })
  writeFileSync(hashFile, `${hash}\n`)
  return true
}
