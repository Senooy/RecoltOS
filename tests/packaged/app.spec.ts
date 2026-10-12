/**
 * App PACKAGÉE :
 *  - build LIVRÉ (`pnpm run pack` / `dist`, fuses `runAsNode` et inspection CLI fermés) : lancé
 *    comme par le Finder (aucun Playwright, impossible avec ces fuses), il rend la grille d'une
 *    bibliothèque de démo : la marque `grid-painted` arrive dans `logs/perf.jsonl` ;
 *  - build de TEST (`pnpm run dist:test` → `dist/test/`, fuses ouverts) piloté par Playwright :
 *    cartes de la grille visibles. Ignoré si `dist/test/` est absent.
 */
import { _electron as electron, expect, test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeDemoLibrary } from '../helpers/demo-library'
import { REPO_ROOT } from '../helpers/paths'
import { makeTmpDir } from '../helpers/tmpdir'

const SHIPPED = join(REPO_ROOT, 'dist/mac-arm64/RecoltOS.app/Contents/MacOS/RecoltOS')
const TESTBUILD = join(REPO_ROOT, 'dist/test/mac-arm64/RecoltOS.app/Contents/MacOS/RecoltOS')

let child: ChildProcess | null = null
test.afterEach(() => {
  child?.kill('SIGTERM')
  child = null
})

test('build livré : la grille est rendue (grid-painted) avec les fuses fermés', async () => {
  test.skip(!existsSync(SHIPPED), 'app packagée absente (pnpm run pack)')
  test.setTimeout(120_000)
  const userData = makeTmpDir('pkg-grid-ud')
  const home = makeTmpDir('pkg-grid-home')
  await makeDemoLibrary(userData, { count: 30, collections: 2 })
  child = spawn(SHIPPED, [], {
    env: {
      PATH: '/usr/bin:/bin',
      HOME: process.env.HOME ?? '',
      RECOLTOS_USER_DATA: userData,
      RECOLTOS_HOME: home,
    },
    stdio: 'ignore',
  })
  const log = join(userData, 'logs', 'perf.jsonl')
  await expect
    .poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : ''), { timeout: 30_000 })
    .toContain('"grid-painted"')
})

test('build de test (dist:test) : Playwright pilote l’app packagée, grille visible', async () => {
  test.skip(!existsSync(TESTBUILD), 'build de test absent (pnpm run dist:test)')
  test.setTimeout(120_000)
  const userData = makeTmpDir('pkg-pw-ud')
  await makeDemoLibrary(userData, { count: 30, collections: 2 })
  const app = await electron.launch({
    executablePath: TESTBUILD,
    env: {
      PATH: '/usr/bin:/bin',
      HOME: process.env.HOME ?? '',
      RECOLTOS_USER_DATA: userData,
      RECOLTOS_HOME: makeTmpDir('pkg-pw-home'),
      RECOLTOS_E2E: '1',
    },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-testid="grid"] [data-testid="card"]').first()).toBeVisible({
      timeout: 30_000,
    })
    expect(await app.evaluate(({ app: a }) => a.isPackaged)).toBe(true)
  } finally {
    await app.close()
  }
})
