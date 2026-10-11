/**
 * Import réel (QA §5.4, ARCHI §6.10) : `RECOLTOS_REAL_LIBRARY` = dossier GatherOS (lecture seule),
 * `RECOLTOS_REAL_DB` = copie de travail de `moodmark.db` (facultatif). Les attendus sont recalculés
 * depuis la source ; les chiffres d'ARCHI §6.10 sont vérifiés si `RECOLTOS_REAL_ARCHI=1`.
 */
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parsePostMeta } from '../../src/shared/post-meta'
import { snapshotGatherosDb } from '../../src/main/importers/gatheros/detect'
import { collectionTree } from '../../src/main/dto/collection-node'
import type { LibraryContext } from '../../src/main/library/library-context'
import { importReal, openTmpLibrary, realSource } from './real-helpers'

const ARCHI = process.env.RECOLTOS_REAL_ARCHI === '1'
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

describe('import réel GatherOS', () => {
  it('source intacte (sha256 db/wal/shm)', () => {
    const s = realSource()
    for (const suffix of ['', '-wal', '-shm'])
      expect(sha(`${s.dbPath}${suffix}`), suffix).toBe(srcHashes[suffix])
  })

  it('éléments : tous les saves hors exemples de démarrage', () => {
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
    if (ARCHI) {
      expect(expected).toBe(412)
      const by = (col: string) =>
        Object.fromEntries(
          (
            lib.db.prepare(`SELECT ${col} k, count(*) n FROM items GROUP BY 1`).all() as {
              k: string
              n: number
            }[]
          ).map((r) => [r.k, r.n]),
        )
      expect(by('kind')).toEqual({ image: 144, video: 211, tweet: 54, url: 3 })
      expect(by('source')).toEqual({ x: 199, instagram: 181, cosmos: 29, web: 2, capture: 1 })
    }
  })

  it('médias : principal + slides locales + slides distantes', () => {
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
    if (ARCHI) {
      expect(one(lib.db, 'SELECT count(*) n FROM item_media')).toBe(751)
      expect(remote).toBe(41)
      expect(firstReport.counts.files).toBe(739)
      expect(one(lib.db, 'SELECT count(*) n FROM item_media WHERE poster_rel IS NOT NULL')).toBe(29)
    }
  })

  it('collections, appartenances, auteurs, tags, rejetés, IA', () => {
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
    if (ARCHI) {
      expect(one(lib.db, 'SELECT count(*) n FROM collections')).toBe(17)
      expect(one(lib.db, 'SELECT count(*) n FROM collection_items')).toBe(252)
      expect(
        one(lib.db, 'SELECT count(DISTINCT author_id) n FROM items WHERE author_id IS NOT NULL'),
      ).toBe(340)
      expect(one(lib.db, 'SELECT count(*) n FROM sync_dismissed')).toBe(2)
      expect(one(lib.db, "SELECT count(*) n FROM items WHERE ai_state = 'done'")).toBe(198)
      expect(lib.db.prepare('SELECT name FROM tags').all()).toEqual([{ name: 'capture-ecran' }])
      expect(one(lib.db, 'SELECT count(*) n FROM item_tags')).toBe(1)
    }
  })

  it('onglets', () => {
    const tabs = lib.db
      .prepare(
        `SELECT sum(deleted_at IS NULL AND hidden_at IS NULL) AS a,
           sum(deleted_at IS NULL AND hidden_at IS NULL AND EXISTS (SELECT 1 FROM collection_items ci WHERE ci.item_id = items.id)) AS s,
           sum(deleted_at IS NOT NULL) AS t, sum(hidden_at IS NOT NULL AND deleted_at IS NULL) AS h FROM items`,
      )
      .get() as { a: number; s: number; t: number; h: number }
    if (ARCHI) expect(tabs).toEqual({ a: 408, s: 250, t: 3, h: 1 })
    expect(tabs.a + tabs.t + tabs.h).toBe(one(lib.db, 'SELECT count(*) n FROM items'))
  })

  it('chaque post_meta importé se relit (aucun post perdu)', () => {
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

  it('couvertures de collection : tie-break par items.id', () => {
    if (!ARCHI) return
    const front = (name: string) =>
      lib.db
        .prepare(
          `SELECT i.title, i.post_meta FROM collections c JOIN collection_items ci ON ci.collection_id = c.id
           JOIN items i ON i.id = ci.item_id WHERE c.name = ? AND i.deleted_at IS NULL
           ORDER BY ci.added_at DESC, i.id DESC LIMIT 1`,
        )
        .get(name) as { title: string | null; post_meta: string | null }
    expect(JSON.stringify(front('Gaming'))).toMatch(/MINECRAFT MOD/)
    expect(front('Photo/Vidéo').title).toBe('Creative Workspace Setup')
    // Même résultat par le DTO (WP-12) : carte de devant = covers[0].
    const tree = collectionTree({ id: 'lreal', root: lib.root }, lib.db)
    const gaming = tree.find((n) => n.name === 'Gaming')!
    expect(gaming.covers[0]!.post?.text ?? '').toMatch(/MINECRAFT MOD/)
    expect(tree.find((n) => n.name === 'Photo/Vidéo')!.covers[0]!.title).toBe(
      'Creative Workspace Setup',
    )
    expect(gaming.count).toBe(36)
  })

  it('ré-import immédiat : 0 création, tout déjà présent, 0 fichier copié', async () => {
    const r = await importReal(lib)
    expect(r.counts.items ?? 0).toBe(0)
    expect(r.counts.skipped_existing).toBe(one(lib.db, 'SELECT count(*) n FROM items'))
    expect(r.counts.files ?? 0).toBe(0)
    expect(r.counts.collections ?? 0).toBe(0)
    expect(r.counts.memberships ?? 0).toBe(0)
  }, 600_000)

  it('purge d’un élément puis ré-import : non recréé ; retrait de collection : appartenance non recréée', async () => {
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

  it('jeton de l’extension absent de toute sortie', () => {
    const dump =
      JSON.stringify(lib.db.prepare('SELECT * FROM settings').all()) + JSON.stringify(firstReport)
    expect(dump.toLowerCase()).not.toContain(('extension' + 'Token').toLowerCase())
  })
})
