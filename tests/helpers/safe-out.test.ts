/**
 * Guard for destructive output folders (`safe-out.ts`) and its hook-up in `make-fixtures` and
 * `seed-bench`: a badly chosen `--out` must never erase data.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeDemoLibrary } from './demo-library'
import { seedBench } from '../../scripts/seed-bench.mjs'
import { REPO_ROOT } from './paths'
import { assertSafeOutDir, FIXTURE_MARKER, markFixtureDir } from './safe-out'
import { makeTmpDir } from './tmpdir'

/** Folder with a precious file: serves as a "victim" never to delete. */
function victim(label = 'victim'): { dir: string; file: string } {
  const dir = makeTmpDir(label)
  const file = join(dir, 'sub/doc.txt')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(file, 'precious')
  return { dir, file }
}

const tsx = (script: string, args: string[]) =>
  spawnSync(
    join(REPO_ROOT, 'node_modules/.bin/tsx'),
    ['--tsconfig', 'tsconfig.node.json', script, ...args],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )

describe('assertSafeOutDir', () => {
  it('accepts a non-existent or empty folder under .tmp', () => {
    const empty = makeTmpDir('safe-empty')
    expect(assertSafeOutDir(empty)).toBe(empty)
    expect(() => assertSafeOutDir(join(empty, 'nouveau/profond'))).not.toThrow()
  })

  it('refuses a non-empty folder without marker, with or without force', () => {
    const { dir, file } = victim()
    expect(() => assertSafeOutDir(dir)).toThrow(/non-empty/)
    expect(() => assertSafeOutDir(dir, { force: true })).toThrow(/non-empty/)
    expect(readFileSync(file, 'utf8')).toBe('precious')
  })

  it('accepts a non-empty folder bearing the marker', () => {
    const { dir } = victim('safe-marked')
    markFixtureDir(dir, 'test')
    expect(existsSync(join(dir, FIXTURE_MARKER))).toBe(true)
    expect(() => assertSafeOutDir(dir)).not.toThrow()
  })

  it('refuses a file in place of the folder', () => {
    const { file } = victim('safe-file')
    expect(() => assertSafeOutDir(file)).toThrow(/is not a folder/)
  })

  it.each([
    ['the root', () => '/'],
    ['$HOME', () => homedir()],
    ['the repo parent', () => join(REPO_ROOT, '..')],
    ['the repo root', () => REPO_ROOT],
    ['"." (current repo folder)', () => '.'],
    ['Application Support', () => join(homedir(), 'Library/Application Support/RecoltOS')],
    ['GatherOS', () => join(homedir(), 'Library/Application Support/GatherOS')],
    ['a GatherOS path elsewhere', () => join(REPO_ROOT, '.tmp/GatherOS/copy')],
  ])('refuses %s, even with force', (_nom, path) => {
    expect(() => assertSafeOutDir(path())).toThrow(/refused/)
    expect(() => assertSafeOutDir(path(), { force: true })).toThrow(/refused/)
  })

  it('refuses an empty path', () => {
    expect(() => assertSafeOutDir('')).toThrow(/is empty/)
  })

  it('outside the temporary zone: refused without force, accepted with it', () => {
    const home = makeTmpDir('safe-home')
    const outside = join(REPO_ROOT, 'out-of-zone-test')
    expect(() => assertSafeOutDir(outside, { home })).toThrow(/--force/)
    expect(assertSafeOutDir(outside, { home, force: true })).toBe(outside)
  })

  it('resolves symbolic links before judging', () => {
    const base = makeTmpDir('safe-link')
    const link = join(base, 'to-home')
    symlinkSync(homedir(), link)
    expect(() => assertSafeOutDir(link, { force: true })).toThrow(/refused/)
    const { dir } = victim('safe-link-victim')
    const link2 = join(base, 'to-victim')
    symlinkSync(dir, link2)
    expect(() => assertSafeOutDir(link2)).toThrow(/non-empty/)
  })
})

describe('hook-up in destructive scripts', () => {
  it('makeDemoLibrary refuses a non-empty folder without marker and deletes nothing', async () => {
    const { dir, file } = victim()
    await expect(makeDemoLibrary(dir, { count: 10, collections: 2 })).rejects.toThrow(/non-empty/)
    await expect(makeDemoLibrary(dir, { count: 10, collections: 2 }, false)).rejects.toThrow(
      /non-empty/,
    )
    expect(readFileSync(file, 'utf8')).toBe('precious')
  })

  it('seedBench refuses a non-empty folder without marker and deletes nothing', async () => {
    const { dir, file } = victim()
    await expect(seedBench(dir, { count: 10, files: false })).rejects.toThrow(/non-empty/)
    expect(readFileSync(file, 'utf8')).toBe('precious')
  })

  it('a generated folder is regenerated without force (marker)', async () => {
    const out = makeTmpDir('safe-regen')
    await seedBench(out, { count: 10, files: false })
    expect(existsSync(join(out, FIXTURE_MARKER))).toBe(true)
    await expect(seedBench(out, { count: 12, files: false })).resolves.toMatchObject({ items: 12 })
    const demo = makeTmpDir('safe-regen-demo')
    await makeDemoLibrary(demo, { count: 10, collections: 2 })
    expect(existsSync(join(demo, FIXTURE_MARKER))).toBe(true)
    await expect(makeDemoLibrary(demo, { count: 10, collections: 2 })).resolves.toMatchObject({
      items: 10,
    })
  })

  it('CLI make-fixtures: --out on a non-empty folder fails (code 2) without erasing anything', () => {
    const { dir, file } = victim()
    const r = tsx('scripts/make-fixtures.mts', ['--out', dir, '--count', '10'])
    expect(r.status, r.stdout).toBe(2)
    expect(r.stderr).toContain('refused')
    expect(readFileSync(file, 'utf8')).toBe('precious')
  })

  it('CLI seed-bench: --out on a non-empty folder fails (code 2) without erasing anything', () => {
    const { dir, file } = victim()
    const r = tsx('scripts/seed-bench.mts', ['--out', dir, '--count', '10', '--no-files'])
    expect(r.status, r.stdout).toBe(2)
    expect(r.stderr).toContain('refused')
    expect(readFileSync(file, 'utf8')).toBe('precious')
  })

  it.each(['scripts/make-fixtures.mts', 'scripts/seed-bench.mts'])(
    'CLI %s: refuses a protected path even with --force',
    (script) => {
      // Non-existent path: if the guard regressed, nothing precious would be at stake.
      const out = join(REPO_ROOT, '.tmp/GatherOS/copy-test')
      const r = tsx(script, ['--out', out, '--force', '--count', '10'])
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('refused')
      expect(existsSync(out)).toBe(false)
    },
  )
})
