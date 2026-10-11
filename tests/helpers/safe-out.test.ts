/**
 * Garde des dossiers de sortie destructifs (`safe-out.ts`) et son branchement dans `make-fixtures` et
 * `seed-bench` (revue WP-01) : un `--out` mal choisi ne doit jamais effacer de données.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeDemoLibrary } from '../../scripts/make-fixtures.mjs'
import { seedBench } from '../../scripts/seed-bench.mjs'
import { REPO_ROOT } from './paths'
import { assertSafeOutDir, FIXTURE_MARKER, markFixtureDir } from './safe-out'
import { makeTmpDir } from './tmpdir'

/** Dossier avec un fichier précieux : sert de « victime » à ne jamais supprimer. */
function victim(label = 'victim'): { dir: string; file: string } {
  const dir = makeTmpDir(label)
  const file = join(dir, 'sub/doc.txt')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(file, 'précieux')
  return { dir, file }
}

const tsx = (script: string, args: string[]) =>
  spawnSync(
    join(REPO_ROOT, 'node_modules/.bin/tsx'),
    ['--tsconfig', 'tsconfig.node.json', script, ...args],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )

describe('assertSafeOutDir', () => {
  it('accepte un dossier inexistant ou vide sous .tmp', () => {
    const empty = makeTmpDir('safe-empty')
    expect(assertSafeOutDir(empty)).toBe(empty)
    expect(() => assertSafeOutDir(join(empty, 'nouveau/profond'))).not.toThrow()
  })

  it('refuse un dossier non vide sans marqueur, avec ou sans force', () => {
    const { dir, file } = victim()
    expect(() => assertSafeOutDir(dir)).toThrow(/non vide/)
    expect(() => assertSafeOutDir(dir, { force: true })).toThrow(/non vide/)
    expect(readFileSync(file, 'utf8')).toBe('précieux')
  })

  it('accepte un dossier non vide qui porte le marqueur', () => {
    const { dir } = victim('safe-marked')
    markFixtureDir(dir, 'test')
    expect(existsSync(join(dir, FIXTURE_MARKER))).toBe(true)
    expect(() => assertSafeOutDir(dir)).not.toThrow()
  })

  it('refuse un fichier à la place du dossier', () => {
    const { file } = victim('safe-file')
    expect(() => assertSafeOutDir(file)).toThrow(/pas un dossier/)
  })

  it.each([
    ['la racine', () => '/'],
    ['$HOME', () => homedir()],
    ['le parent du dépôt', () => join(REPO_ROOT, '..')],
    ['la racine du dépôt', () => REPO_ROOT],
    ['« . » (dossier courant du dépôt)', () => '.'],
    ['Application Support', () => join(homedir(), 'Library/Application Support/RecoltOS')],
    ['GatherOS', () => join(homedir(), 'Library/Application Support/GatherOS')],
    ['un chemin GatherOS ailleurs', () => join(REPO_ROOT, '.tmp/GatherOS/copie')],
  ])('refuse %s, même avec force', (_nom, path) => {
    expect(() => assertSafeOutDir(path())).toThrow(/refusé/)
    expect(() => assertSafeOutDir(path(), { force: true })).toThrow(/refusé/)
  })

  it('refuse un chemin vide', () => {
    expect(() => assertSafeOutDir('')).toThrow(/vide/)
  })

  it('hors zone temporaire : refusé sans force, accepté avec', () => {
    const home = makeTmpDir('safe-home')
    const outside = join(REPO_ROOT, 'out-of-zone-test')
    expect(() => assertSafeOutDir(outside, { home })).toThrow(/--force/)
    expect(assertSafeOutDir(outside, { home, force: true })).toBe(outside)
  })

  it('résout les liens symboliques avant de juger', () => {
    const base = makeTmpDir('safe-link')
    const link = join(base, 'vers-home')
    symlinkSync(homedir(), link)
    expect(() => assertSafeOutDir(link, { force: true })).toThrow(/refusé/)
    const { dir } = victim('safe-link-victim')
    const link2 = join(base, 'vers-victime')
    symlinkSync(dir, link2)
    expect(() => assertSafeOutDir(link2)).toThrow(/non vide/)
  })
})

describe('branchement dans les scripts destructifs', () => {
  it('makeDemoLibrary refuse un dossier non vide sans marqueur et ne supprime rien', async () => {
    const { dir, file } = victim()
    await expect(makeDemoLibrary(dir, { count: 10, collections: 2 })).rejects.toThrow(/non vide/)
    await expect(makeDemoLibrary(dir, { count: 10, collections: 2 }, false)).rejects.toThrow(
      /non vide/,
    )
    expect(readFileSync(file, 'utf8')).toBe('précieux')
  })

  it('seedBench refuse un dossier non vide sans marqueur et ne supprime rien', async () => {
    const { dir, file } = victim()
    await expect(seedBench(dir, { count: 10, files: false })).rejects.toThrow(/non vide/)
    expect(readFileSync(file, 'utf8')).toBe('précieux')
  })

  it('un dossier fabriqué se régénère sans force (marqueur)', async () => {
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

  it('CLI make-fixtures : --out sur un dossier non vide échoue (code 2) sans rien effacer', () => {
    const { dir, file } = victim()
    const r = tsx('scripts/make-fixtures.mts', ['--out', dir, '--count', '10'])
    expect(r.status, r.stdout).toBe(2)
    expect(r.stderr).toContain('refusé')
    expect(readFileSync(file, 'utf8')).toBe('précieux')
  })

  it('CLI seed-bench : --out sur un dossier non vide échoue (code 2) sans rien effacer', () => {
    const { dir, file } = victim()
    const r = tsx('scripts/seed-bench.mts', ['--out', dir, '--count', '10', '--no-files'])
    expect(r.status, r.stdout).toBe(2)
    expect(r.stderr).toContain('refusé')
    expect(readFileSync(file, 'utf8')).toBe('précieux')
  })

  it.each(['scripts/make-fixtures.mts', 'scripts/seed-bench.mts'])(
    'CLI %s : refuse un chemin protégé même avec --force',
    (script) => {
      // Chemin inexistant : si la garde régressait, rien de précieux ne serait en jeu.
      const out = join(REPO_ROOT, '.tmp/GatherOS/copie-test')
      const r = tsx(script, ['--out', out, '--force', '--count', '10'])
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('refusé')
      expect(existsSync(out)).toBe(false)
    },
  )
})
