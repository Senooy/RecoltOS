import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seedBench } from '../../scripts/seed-bench.mjs'
import { openTestDb } from './db'
import { REPO_ROOT } from './paths'
import { makeTmpDir } from './tmpdir'

describe('seed-bench', () => {
  it('synthetic items at scale, cloned files', async () => {
    const out = makeTmpDir('bench')
    const res = await seedBench(out, { count: 300 })
    expect(res.items).toBe(300)
    expect(res.files).toBeGreaterThan(300)
    const db = openTestDb({ file: join(out, 'libraries/default/recolt.db') })
    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n
    expect(n('SELECT count(*) n FROM items')).toBe(300)
    expect(n("SELECT count(*) n FROM items WHERE kind='tweet'")).toBe(40) // 54/408 of 300, rounded
    expect(n('SELECT count(*) n FROM items_fts')).toBe(300)
    const row = db.prepare('SELECT thumb_rel FROM item_media LIMIT 1').get() as {
      thumb_rel: string
    }
    expect(existsSync(join(out, 'libraries/default', row.thumb_rel))).toBe(true)
    db.close()
  })

  it('--no-files: database only', async () => {
    const out = makeTmpDir('bench-db')
    const res = await seedBench(out, { count: 100, files: false })
    expect(res.files).toBe(0)
    expect(existsSync(join(out, 'libraries/default/thumbs'))).toBe(false)
  })
})

describe('seed-bench CLI: --count validated', () => {
  it.each(['abc', '-1', '2.5', ''])('--count "%s": exit 2, nothing written', (value) => {
    const out = makeTmpDir('bench-badnum')
    const r = spawnSync(
      join(REPO_ROOT, 'node_modules/.bin/tsx'),
      [
        '--tsconfig',
        'tsconfig.node.json',
        'scripts/seed-bench.mts',
        '--out',
        out,
        `--count=${value}`,
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('--count doit être un entier ≥ 0')
    expect(r.stderr).toContain('usage :')
    expect(existsSync(join(out, 'libraries.json'))).toBe(false)
  })
})
