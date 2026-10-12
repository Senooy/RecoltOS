/**
 * PACKAGED app:
 *  - SHIPPED build (`pnpm run pack` / `dist`, fuses `runAsNode` and CLI inspection closed): launched
 *    as from Finder (no Playwright, impossible with these fuses), it renders the grid of a
 *    demo library: the `grid-painted` mark appears in `logs/perf.jsonl`;
 *  - TEST build (`pnpm run dist:test` → `dist/test/`, fuses open) driven by Playwright:
 *    grid cards visible. Skipped if `dist/test/` is absent.
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

test('shipped build: the grid is rendered (grid-painted) with fuses closed', async () => {
  test.skip(!existsSync(SHIPPED), 'packaged app missing (pnpm run pack)')
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

test('test build (dist:test): Playwright drives the packaged app, grid visible', async () => {
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
      RECOLTOS_LANG: 'fr',
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
