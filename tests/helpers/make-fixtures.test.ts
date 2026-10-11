import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  avatarKey,
  cacheKey,
  isDemoLibraryCurrent,
  latestMigrationVersion,
  makeDemoLibrary,
} from './demo-library'
import { openTestDb } from './db'
import { REPO_ROOT } from './paths'
import { findFfmpeg } from './synthetic-media'
import { makeTmpDir } from './tmpdir'

type Row = Record<string, number | string | null>

describe('make-fixtures', () => {
  it('bibliothèque de démo : base valide, médias présents, avatars en cache local', async () => {
    const out = makeTmpDir('demo')
    const res = await makeDemoLibrary(out, { count: 40, collections: 4 })
    expect(res.items).toBe(40)
    expect(existsSync(join(out, 'libraries.json'))).toBe(true)

    const db = openTestDb({ file: join(res.libraryDir, 'recolt.db') })
    const all = (sql: string) => db.prepare(sql).all() as Row[]
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(all('SELECT count(*) n FROM collections')[0]?.n).toBe(4)
    expect(all("SELECT count(*) n FROM items WHERE kind='tweet'")[0]?.n).toBeGreaterThan(0)

    const media = all(
      'SELECT file_rel, thumb_rel, poster_rel, media_type, file_size, width FROM item_media',
    )
    expect(media.length).toBeGreaterThanOrEqual(40 - 10)
    for (const m of media) {
      expect(existsSync(join(res.libraryDir, String(m.file_rel))), String(m.file_rel)).toBe(true)
      expect(existsSync(join(res.libraryDir, String(m.thumb_rel))), String(m.thumb_rel)).toBe(true)
      expect(Number(m.width)).toBeLessThanOrEqual(480)
      if (m.media_type === 'video') {
        expect(existsSync(join(res.libraryDir, String(m.poster_rel)))).toBe(true)
        if (findFfmpeg()) expect(Number(m.file_size)).toBeGreaterThan(500)
      }
    }
    // Avatars X en cache local ; Instagram « expiré » (monogramme), comme la bibliothèque réelle.
    for (const a of all('SELECT platform, handle, avatar_rel, avatar_status FROM authors')) {
      if (a.platform === 'instagram') {
        expect(a.avatar_status).toBe('expired')
        expect(a.avatar_rel).toBeNull()
      } else {
        expect(a.avatar_status).toBe('ok')
        expect(a.avatar_rel).toBe(
          `avatars/${String(a.platform)}/${avatarKey(String(a.handle))}.jpg`,
        )
        expect(statSync(join(res.libraryDir, String(a.avatar_rel))).size).toBeGreaterThan(100)
      }
    }
    // Aucune URL distante dans les colonnes de chemin (le renderer ne reçoit jamais d'http).
    expect(all("SELECT count(*) n FROM item_media WHERE file_rel LIKE 'http%'")[0]?.n).toBe(0)
    db.close()
  })

  it('le cache est stable et clone la même base', async () => {
    const opts = { count: 25, collections: 3 }
    const a = await makeDemoLibrary(makeTmpDir('demo-a'), opts)
    const b = await makeDemoLibrary(makeTmpDir('demo-b'), opts)
    expect(b.cached).toBe(true)
    expect(a.items).toBe(b.items)
    expect(cacheKey({ count: 25, collections: 3, trashed: 0, hidden: 0 })).toBe(
      cacheKey({ count: 25, collections: 3, trashed: 0, hidden: 0 }),
    )
    expect(cacheKey({ count: 26, collections: 3, trashed: 0, hidden: 0 })).not.toBe(
      cacheKey({ count: 25, collections: 3, trashed: 0, hidden: 0 }),
    )
  })

  it('CLI : --out et --if-missing (dev:demo)', () => {
    const out = makeTmpDir('demo-cli')
    const run = () =>
      spawnSync(
        join(REPO_ROOT, 'node_modules/.bin/tsx'),
        [
          '--tsconfig',
          'tsconfig.node.json',
          'scripts/make-fixtures.mts',
          '--out',
          out,
          '--if-missing',
          '--count',
          '20',
        ],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      )
    const first = run()
    expect(first.status, first.stderr).toBe(0)
    expect(first.stdout).toContain('20 éléments')
    expect(run().stdout).toContain('existe déjà')

    // user_version antérieur à la dernière migration : régénération, pas réutilisation.
    const dbFile = join(out, 'libraries/default/recolt.db')
    const raw = new Database(dbFile)
    raw.pragma('user_version = 0')
    raw.close()
    expect(isDemoLibraryCurrent(out)).toBe(false)
    const stale = run()
    expect(stale.status, stale.stderr).toBe(0)
    expect(stale.stdout).toContain('périmé')
    expect(isDemoLibraryCurrent(out)).toBe(true)
  })

  it('isDemoLibraryCurrent : absent, corrompu ou à jour', () => {
    expect(isDemoLibraryCurrent(makeTmpDir('demo-current-absent'))).toBe(false)

    const corrupt = makeTmpDir('demo-current-corrupt')
    mkdirSync(join(corrupt, 'libraries/default'), { recursive: true })
    writeFileSync(join(corrupt, 'libraries.json'), '{}')
    writeFileSync(join(corrupt, 'libraries/default/recolt.db'), 'pas une base')
    expect(isDemoLibraryCurrent(corrupt)).toBe(false)

    const ok = makeTmpDir('demo-current-ok')
    writeFileSync(join(ok, 'libraries.json'), '{}')
    openTestDb({ file: join(ok, 'libraries/default/recolt.db') }).close()
    expect(latestMigrationVersion()).toBeGreaterThan(0)
    expect(isDemoLibraryCurrent(ok)).toBe(true)
  })

  it('cache : un .building-<pid> mort (build interrompu) est nettoyé au build suivant', async () => {
    const opts = { count: 27, collections: 3 }
    const cache = join(
      REPO_ROOT,
      'node_modules/.cache/recoltos-demo',
      cacheKey({ ...opts, trashed: 0, hidden: 0 }),
    )
    const stale = `${cache}.building-999999`
    mkdirSync(stale, { recursive: true })
    writeFileSync(join(stale, 'partiel.txt'), 'x')
    await makeDemoLibrary(makeTmpDir('demo-stale'), opts, true)
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(join(cache, 'libraries.json'))).toBe(true)
  })
})

describe('CLI : options numériques validées', () => {
  it.each([
    ['--count', 'abc'],
    ['--count', '-3'],
    ['--count', '1.5'],
    ['--collections', 'x'],
    ['--trashed', ''],
    ['--hidden', '2e'],
  ])('%s %s : sortie 2 avec message d’usage, aucune bibliothèque créée', (flag, value) => {
    const out = makeTmpDir('fixtures-badnum')
    const r = spawnSync(
      join(REPO_ROOT, 'node_modules/.bin/tsx'),
      [
        '--tsconfig',
        'tsconfig.node.json',
        'scripts/make-fixtures.mts',
        '--out',
        out,
        `${flag}=${value}`,
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(r.status).toBe(2)
    expect(r.stderr).toContain(flag)
    expect(r.stderr).toContain('entier ≥ 0')
    expect(r.stderr).toContain('usage :')
    expect(r.stdout).not.toContain('éléments')
    expect(existsSync(join(out, 'libraries.json'))).toBe(false)
  })
})
