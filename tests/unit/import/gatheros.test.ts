/**
 * GatherOS importer on the anonymized synthetic fixture.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'
import { ImportOptions } from '../../../src/shared/ipc/import'
import { parsePostMeta } from '../../../src/shared/post-meta'
import {
  detectRunning,
  parseSingletonLock,
  pickLibrary,
  previewGatheros,
  readGatherosPrefs,
} from '../../../src/main/importers/gatheros/detect'
import {
  deterministicUuid,
  mapDismissedKey,
  mapSource,
} from '../../../src/main/importers/gatheros/map'
import { runGatherosImport, type ImportDeps } from '../../../src/main/importers/gatheros/run'
import { cloneFile, hashFile } from '../../../src/main/workers/media/files'
import { FAKE_EXTENSION_TOKEN, loadSeed, makeLegacyLibrary } from '../../helpers/legacy-library'
import { makeTmpDir } from '../../helpers/tmpdir'
import { makeHarness, type JobsHarness } from '../jobs/helpers'

let h: JobsHarness | null = null
afterEach(async () => {
  await h?.cleanup()
  h = null
})

const sha = (p: string) =>
  existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null

function deps(h: JobsHarness, extra: Partial<ImportDeps> = {}): ImportDeps {
  return {
    lib: h.lib,
    hashFile: (abs) => hashFile({ abs }),
    cloneFile: (src, dst) => cloneFile({ src, dst }),
    log: h.services.log,
    ...extra,
  }
}

const one = (h: JobsHarness, sql: string) => (h.t.db.prepare(sql).get() as { n: number }).n

describe('GatherOS importer (fixture)', () => {
  it('imports the fixture: accounts, media, post_meta, collections, tags, rejected, no ai.enrich', async () => {
    h = makeHarness()
    const legacy = await makeLegacyLibrary(makeTmpDir('gatheros-'))
    const before = ['', '-wal', '-shm'].map((s) => sha(legacy.dbPath + s))
    const report = await runGatherosImport(
      { source: pickLibrary(legacy.root), options: ImportOptions.parse({}) },
      deps(h),
    )
    expect(['', '-wal', '-shm'].map((s) => sha(legacy.dbPath + s))).toEqual(before)

    expect(report.state).toBe('done')
    expect(report.counts.items).toBe(10)
    expect(report.counts.skipped_starter).toBe(1)
    expect(one(h, 'SELECT count(*) n FROM items')).toBe(10)
    expect(one(h, 'SELECT count(*) n FROM items WHERE deleted_at IS NOT NULL')).toBe(1)
    expect(one(h, 'SELECT count(*) n FROM items WHERE hidden_at IS NOT NULL')).toBe(1)
    // items.uuid = origin_id = GatherOS id.
    expect(
      one(h, "SELECT count(*) n FROM items WHERE uuid = origin_id AND origin = 'gatheros'"),
    ).toBe(10)

    // Carousel: local slides copied, posters imported, remote ones in `remote` with `media.download`.
    const seed = loadSeed()
    const slides = seed.saves.reduce((n, s) => {
      const m = s.tweet_meta ? (JSON.parse(s.tweet_meta) as { media?: unknown[] }).media : undefined
      return n + Math.max(0, (m?.length ?? 0) - 1)
    }, 0)
    expect(one(h, 'SELECT count(*) n FROM item_media')).toBe(10 + slides)
    const remote = one(h, "SELECT count(*) n FROM item_media WHERE status = 'remote'")
    expect(one(h, "SELECT count(*) n FROM jobs WHERE type = 'media.download'")).toBe(remote)
    expect(
      one(h, 'SELECT count(*) n FROM item_media WHERE poster_rel IS NOT NULL'),
    ).toBeGreaterThan(0)
    expect(
      one(
        h,
        "SELECT count(*) n FROM item_media WHERE status = 'processing' AND content_hash IS NULL",
      ),
    ).toBe(0)
    expect(one(h, 'SELECT count(*) n FROM item_media WHERE legacy_thumb_rel IS NOT NULL')).toBe(10)
    expect(one(h, "SELECT count(*) n FROM jobs WHERE type = 'ai.enrich'")).toBe(0)

    // post_meta v1 readable again for each item that had a tweet_meta.
    const posts = h.t.db
      .prepare('SELECT post_meta FROM items WHERE post_meta IS NOT NULL')
      .all() as { post_meta: string }[]
    expect(posts.length).toBe(seed.saves.filter((s) => s.tweet_meta).length)
    for (const p of posts) expect(parsePostMeta(p.post_meta)).not.toBeNull()
    const quoted = parsePostMeta(
      (
        h.t.db.prepare('SELECT post_meta FROM items WHERE uuid = ?').get(legacyIdOf(seed, 0)) as {
          post_meta: string
        }
      ).post_meta,
    )
    expect(quoted?.quoted?.author?.handle).toMatch(/^handle_q/)
    expect(quoted?.author?.handle).not.toMatch(/^@/)

    // Collections: parents and covers, memberships (hidden and trash included).
    expect(one(h, 'SELECT count(*) n FROM collections')).toBe(4)
    expect(one(h, 'SELECT count(*) n FROM collections WHERE parent_id IS NOT NULL')).toBe(1)
    expect(one(h, 'SELECT count(*) n FROM collections WHERE cover_item_id IS NOT NULL')).toBe(1)
    expect(one(h, 'SELECT count(*) n FROM collection_items')).toBe(8)

    // Tags: sources → chips (no tag), startup ignored; rejected.
    expect(h.t.db.prepare('SELECT name FROM tags').all()).toEqual([])
    expect(
      h.t.db.prepare('SELECT source, external_id FROM sync_dismissed ORDER BY source').all(),
    ).toEqual([
      { source: 'instagram', external_id: 'CodeDismissed1' },
      { source: 'x', external_id: '123456789' },
    ])
    expect(one(h, 'SELECT count(*) n FROM sync_items')).toBeGreaterThan(0)
    expect(existsSync(h.lib.paths.abs(report.reportRel!))).toBe(true)
    expect(readdirSync(h.lib.paths.dir('import')).some((n) => n.startsWith('gatheros-'))).toBe(
      false,
    )
  })

  it('re-import: 0 created, 0 file copied; purge then re-import: not recreated', async () => {
    h = makeHarness()
    const legacy = await makeLegacyLibrary(makeTmpDir('gatheros-'))
    const src = pickLibrary(legacy.root)
    const opts = ImportOptions.parse({})
    await runGatherosImport({ source: src, options: opts }, deps(h))
    const r2 = await runGatherosImport({ source: src, options: opts }, deps(h))
    expect(r2.counts.items ?? 0).toBe(0)
    expect(r2.counts.skipped_existing).toBe(10)
    expect(r2.counts.files ?? 0).toBe(0)
    const victim = h.t.repos.items.getByOrigin('gatheros', legacy.ids.carousel)!
    h.t.repos.items.purge([victim.id])
    const col = h.t.db
      .prepare('SELECT collection_id c, item_id i FROM collection_items LIMIT 1')
      .get() as { c: number; i: number }
    h.t.repos.collections.removeItems(col.c, [col.i])
    const links = one(h, 'SELECT count(*) n FROM collection_items')
    const r3 = await runGatherosImport({ source: src, options: opts }, deps(h))
    expect(r3.counts.items ?? 0).toBe(0)
    expect(r3.counts.skipped_tombstone).toBe(1)
    expect(one(h, 'SELECT count(*) n FROM collection_items')).toBe(links)
    expect(one(h, 'SELECT count(*) n FROM items')).toBe(9)
  })

  it('cancellation during the files phase then resume: correct total', async () => {
    h = makeHarness()
    const legacy = await makeLegacyLibrary(makeTmpDir('gatheros-'))
    const src = pickLibrary(legacy.root)
    const ac = new AbortController()
    let copied = 0
    await expect(
      runGatherosImport(
        { source: src, options: ImportOptions.parse({}) },
        deps(h, {
          concurrency: 1,
          signal: ac.signal,
          cloneFile: async (s, d) => {
            if (++copied === 3) ac.abort()
            return cloneFile({ src: s, dst: d })
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(h.t.db.prepare('SELECT state FROM import_runs').all()).toEqual([{ state: 'cancelled' }])
    expect(one(h, 'SELECT count(*) n FROM items')).toBe(0)
    const r = await runGatherosImport({ source: src, options: ImportOptions.parse({}) }, deps(h))
    expect(r.counts.items).toBe(10)
    expect(one(h, 'SELECT count(*) n FROM items')).toBe(10)
  })

  it('options: without trash or hidden items', async () => {
    h = makeHarness()
    const legacy = await makeLegacyLibrary(makeTmpDir('gatheros-'))
    const r = await runGatherosImport(
      {
        source: pickLibrary(legacy.root),
        options: ImportOptions.parse({ includeTrash: false, includeHidden: false }),
      },
      deps(h),
    )
    expect(r.counts.items).toBe(8)
    expect(r.counts.excluded_trash).toBe(1)
    expect(r.counts.excluded_hidden).toBe(1)
  })
})

describe('detection and lock', () => {
  it('pid after the LAST dash; running GatherOS detected with a host containing dashes', async () => {
    expect(parseSingletonLock('macbook-pro-de-test.home-26365')).toEqual({
      host: 'macbook-pro-de-test.home',
      pid: 26365,
    })
    expect(parseSingletonLock('sans-pid')).toBeNull()
    const legacy = await makeLegacyLibrary(makeTmpDir('gatheros-'), {
      running: { host: 'mon-mac-de-test.local', pid: 4242 },
    })
    const running = await detectRunning(legacy.root, {
      kill: () => undefined,
      psComm: () => Promise.resolve('GatherOS\n'),
      pgrep: () => Promise.resolve(false),
    })
    expect(running).toEqual({ running: true, host: 'mon-mac-de-test.local', pid: 4242 })
    // pid reused by another process: not GatherOS.
    const reused = await detectRunning(legacy.root, {
      kill: () => undefined,
      psComm: () => Promise.resolve('/usr/bin/vim\n'),
      pgrep: () => Promise.resolve(false),
    })
    expect(reused.running).toBe(false)
  })

  it('detection preview on a copy; settings by allowlist without the extension token', async () => {
    const legacy = await makeLegacyLibrary(makeTmpDir('gatheros-'))
    const { preview, schemaVersion } = previewGatheros(
      pickLibrary(legacy.root),
      makeTmpDir('gatheros-work-'),
    )
    expect(schemaVersion).toBe(17)
    expect(preview).toMatchObject({ items: 10, starter: 1, collections: 4, trash: 1, hidden: 1 })
    const prefs = readGatherosPrefs(legacy.root)
    expect(prefs).toEqual({ theme: 'dark', defaultColumns: 5, videoMuted: true })
    expect(JSON.stringify(prefs)).not.toContain(FAKE_EXTENSION_TOKEN)
  })

  it('matching rules', () => {
    expect(mapDismissedKey('ig:Abc')).toEqual({ source: 'instagram', externalId: 'Abc' })
    expect(mapDismissedKey('x:123')).toEqual({ source: 'x', externalId: '123' })
    expect(mapDismissedKey('987')).toEqual({ source: 'x', externalId: '987' })
    expect(mapDismissedKey('zz:1')).toEqual({ source: 'unknown', externalId: 'zz:1' })
    expect(
      mapSource({ source: 'x', source_url: 'https://www.reddit.com/r/a', kind: 'url' }, []),
    ).toBe('web')
    expect(
      mapSource({ source: 'x', source_url: 'https://x.com/a/status/1', kind: 'url' }, []),
    ).toBe('x')
    expect(mapSource({ source: 'x', source_url: '', kind: 'image' }, ['screenshot'])).toBe(
      'capture',
    )
    expect(mapSource({ source: 'x', source_url: null, kind: 'image' }, [])).toBe('local')
    expect(deterministicUuid('a')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})

describe('anonymized fixture (anti-leak)', () => {
  it('seed.json: each text value follows a synthetic pattern', () => {
    const seed = loadSeed()
    const allowed = [
      /^[0-9a-f-]{36}$/,
      /^\{\{LIB\}\}\/(images|thumbs)\/[0-9a-f-]{36}\.(webp|jpg|mp4|png)$/,
      /^(Titre|description|ocr|prompt|note|texte) \d+$/,
      /^https:\/\/x\.com\/handle_\d+\/status\/\d+$/,
      /^https:\/\/www\.instagram\.com\/p\/code\d+\/$/,
      /^https:\/\/www\.cosmos\.so\/e\/\d+$/,
      /^https:\/\/www\.example\.test\/page\/\d+$/,
      /^https:\/\/example\.test\/(avatar|media)_\d+\.jpg$/,
      /^moodmark-file:\/\/local\/\{\{LIB\}\}\/images\/[0-9a-f-]{36}\.(jpg|mp4|webp|png)$/,
      /^@?(handle|author)_q?\d+$/,
      /^(image|video|tweet|url|x|instagram|cosmos)$/,
      /^\[\[?[-\d.,e[\]#a-f"]*\]$/, // palettes (colors)
      /^[0-9a-f]{64}$/,
      /^$/,
    ]
    const bad: string[] = []
    const visit = (v: unknown) => {
      if (typeof v === 'string') {
        if (v.startsWith('{') && v.endsWith('}')) return visit(JSON.parse(v))
        if (!allowed.some((re) => re.test(v))) bad.push(v.slice(0, 40))
      } else if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === 'object') Object.values(v).forEach(visit)
    }
    seed.saves.forEach(visit)
    expect(bad).toEqual([])
  })
})

function legacyIdOf(seed: ReturnType<typeof loadSeed>, i: number): string {
  return seed.saves[i]!.id
}
