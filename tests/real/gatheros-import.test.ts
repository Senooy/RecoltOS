/**
 * Import from GatherOS on a real library: `RECOLTOS_REAL_LIBRARY` = folder of
 * the old app (read-only), `RECOLTOS_REAL_DB` = working copy of `moodmark.db`
 * (optional). All expected values are recomputed from the source.
 */
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parsePostMeta } from '../../src/shared/post-meta'
import { snapshotGatherosDb } from '../../src/main/importers/gatheros/detect'
import type { LibraryContext } from '../../src/main/library/library-context'
import { importReal, openTmpLibrary, realSource } from './real-helpers'

let lib: LibraryContext
let src: Database.Database
let firstReport: Awaited<ReturnType<typeof importReal>>
const sha = (p: string) =>
  existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null
const srcHashes: Record<string, string | null> = {}

beforeAll(async () => {
  const s = realSource()
  for (const suffix of ['', '-wal', '-shm']) srcHashes[suffix] = sha(`${s.dbPath}${suffix}`)
  lib = openTmpLibrary()
  firstReport = await importReal(lib)
  const snap = snapshotGatherosDb(s.dbPath, `${lib.root}/tmp/expect`)
  src = new Database(snap.path, { readonly: true })
}, 600_000)

afterAll(() => {
  src?.close()
  lib?.db.close()
  if (lib) rmSync(lib.root, { recursive: true, force: true })
})

const one = <T = number>(db: Database.Database, sql: string): T =>
  (db.prepare(sql).get() as { n: T }).n

const STARTER = `(SELECT st.save_id FROM save_tags st JOIN tags t ON t.id = st.tag_id WHERE t.name = '__starter__')`

describe('real GatherOS import', () => {
  it('source intact (sha256 db/wal/shm)', () => {
    const s = realSource()
    for (const suffix of ['', '-wal', '-shm'])
      expect(sha(`${s.dbPath}${suffix}`), suffix).toBe(srcHashes[suffix])
  })

  it('items: all saves except starter examples', () => {
    const expected = one(src, `SELECT count(*) n FROM saves WHERE id NOT IN ${STARTER}`)
    expect(one(lib.db, 'SELECT count(*) n FROM items')).toBe(expected)
    expect(firstReport.counts.items).toBe(expected)
    for (const kind of ['image', 'video', 'tweet', 'url']) {
      const e = one(
        src,
        `SELECT count(*) n FROM saves WHERE kind = '${kind}' AND id NOT IN ${STARTER}`,
      )
      expect(one(lib.db, `SELECT count(*) n FROM items WHERE kind = '${kind}'`), kind).toBe(e)
    }
  })

  it('media: main + local slides + remote slides', () => {
    const slides = one(
      src,
      `SELECT count(*) n FROM saves s, json_each(s.tweet_meta, '$.media') m
       WHERE json_valid(s.tweet_meta) AND m.key >= 1 AND s.id NOT IN ${STARTER}`,
    )
    const items = one(lib.db, 'SELECT count(*) n FROM items')
    expect(one(lib.db, 'SELECT count(*) n FROM item_media')).toBe(items + slides)
    const remote = one(
      src,
      `SELECT count(*) n FROM saves s, json_each(s.tweet_meta, '$.media') m
       WHERE json_valid(s.tweet_meta) AND m.key >= 1 AND m.value->>'url' NOT LIKE 'moodmark-file://%' AND s.id NOT IN ${STARTER}`,
    )
    expect(one(lib.db, "SELECT count(*) n FROM item_media WHERE status = 'remote'")).toBe(remote)
    expect(firstReport.counts.files_missing ?? 0).toBe(0)
  })

  it('collections, memberships, authors, tags, rejected, AI', () => {
    expect(one(lib.db, 'SELECT count(*) n FROM collections')).toBe(
      one(src, 'SELECT count(*) n FROM collections'),
    )
    expect(one(lib.db, 'SELECT count(*) n FROM collection_items')).toBe(
      one(src, `SELECT count(*) n FROM collection_items WHERE save_id NOT IN ${STARTER}`),
    )
    expect(one(lib.db, 'SELECT count(*) n FROM sync_dismissed')).toBe(
      one(src, 'SELECT count(*) n FROM dismissed_tweets'),
    )
    expect(one(lib.db, "SELECT count(*) n FROM jobs WHERE type = 'ai.enrich'")).toBe(0)
    expect(one(lib.db, "SELECT count(*) n FROM items WHERE ai_state = 'done'")).toBe(
      one(
        src,
        `SELECT count(*) n FROM saves WHERE coalesce(trim(ai_description), '') <> '' AND id NOT IN ${STARTER}`,
      ),
    )
  })

  it('tabs', () => {
    const tabs = lib.db
      .prepare(
        `SELECT sum(deleted_at IS NULL AND hidden_at IS NULL) AS a,
           sum(deleted_at IS NULL AND hidden_at IS NULL AND EXISTS (SELECT 1 FROM collection_items ci WHERE ci.item_id = items.id)) AS s,
           sum(deleted_at IS NOT NULL) AS t, sum(hidden_at IS NOT NULL AND deleted_at IS NULL) AS h FROM items`,
      )
      .get() as { a: number; s: number; t: number; h: number }
    expect(tabs.a + tabs.t + tabs.h).toBe(one(lib.db, 'SELECT count(*) n FROM items'))
  })

  it('every imported post_meta reads back (no post lost)', () => {
    const rows = lib.db.prepare('SELECT uuid, post_meta FROM items').all() as {
      uuid: string
      post_meta: string | null
    }[]
    const withMeta = one(
      src,
      `SELECT count(*) n FROM saves WHERE json_valid(tweet_meta) AND id NOT IN ${STARTER}`,
    )
    const ok = rows.filter((r) => r.post_meta !== null && parsePostMeta(r.post_meta) !== null)
    expect(ok.length).toBe(withMeta)
  })

  it('immediate re-import: 0 created, everything already present, 0 files copied', async () => {
    const r = await importReal(lib)
    expect(r.counts.items ?? 0).toBe(0)
    expect(r.counts.skipped_existing).toBe(one(lib.db, 'SELECT count(*) n FROM items'))
    expect(r.counts.files ?? 0).toBe(0)
    expect(r.counts.collections ?? 0).toBe(0)
    expect(r.counts.memberships ?? 0).toBe(0)
  }, 600_000)

  it('purge an item then re-import: not recreated; removal from a collection: membership not recreated', async () => {
    const victim = lib.db.prepare('SELECT id FROM items ORDER BY id LIMIT 1').get() as {
      id: number
    }
    lib.repos.items.purge([victim.id])
    const ci = lib.db
      .prepare('SELECT collection_id, item_id FROM collection_items LIMIT 1')
      .get() as {
      collection_id: number
      item_id: number
    }
    lib.repos.collections.removeItems(ci.collection_id, [ci.item_id])
    const before = one(lib.db, 'SELECT count(*) n FROM items')
    const links = one(lib.db, 'SELECT count(*) n FROM collection_items')
    const r = await importReal(lib)
    expect(r.counts.items ?? 0).toBe(0)
    expect(r.counts.skipped_tombstone).toBe(1)
    expect(one(lib.db, 'SELECT count(*) n FROM items')).toBe(before)
    expect(one(lib.db, 'SELECT count(*) n FROM collection_items')).toBe(links)
  }, 600_000)

  it('extension token absent from all output', () => {
    const dump =
      JSON.stringify(lib.db.prepare('SELECT * FROM settings').all()) + JSON.stringify(firstReport)
    expect(dump.toLowerCase()).not.toContain(('extension' + 'Token').toLowerCase())
  })
})
