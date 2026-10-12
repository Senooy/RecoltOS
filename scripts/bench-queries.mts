/**
 * Banc des requêtes du main (ARCHI §8, QA §11.3 ; WP-71), directement sur une base (sans IPC) :
 * page de liste (première, suivante, onglets, tri), compteurs (sans cache), FTS (`runSearch`),
 * `EXPLAIN QUERY PLAN` des requêtes chaudes, `PRAGMA optimize` et `wal_checkpoint` sur une copie.
 *
 *   tsx --tsconfig tsconfig.node.json scripts/bench-queries.mts --db <recolt.db> [--runs 50] [--json f]
 *
 * La base est ouverte en LECTURE SEULE ; les opérations d'écriture portent sur une copie temporaire.
 */
import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { invalidateCounts, tabCounts } from '../src/main/db/queries/counts'
import { listItems } from '../src/main/db/queries/list'
import { runSearch } from '../src/main/search/search'

export interface Timing {
  p50ms: number
  p95ms: number
  maxms: number
}

function timeIt(fn: () => unknown, runs: number): Timing {
  for (let i = 0; i < 5; i++) fn()
  const v: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    fn()
    v.push(performance.now() - t)
  }
  v.sort((a, b) => a - b)
  const r = (x: number) => Math.round(x * 100) / 100
  return {
    p50ms: r(v[Math.floor(runs / 2)]!),
    p95ms: r(v[Math.min(runs - 1, Math.floor(runs * 0.95))]!),
    maxms: r(v[runs - 1]!),
  }
}

export function benchQueries(dbFile: string, runs = 50) {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true })
  db.pragma('cache_size = -32000')
  db.pragma('mmap_size = 268435456')
  const items = (db.prepare('SELECT count(*) n FROM items').get() as { n: number }).n
  const list = (extra: Record<string, unknown>) => () =>
    listItems(db, { scope: 'library', tab: 'all', limit: 100, ...extra } as never)
  const first = listItems(db, { scope: 'library', tab: 'all', limit: 100 } as never)
  // Termes FTS réels : premier mot (≥ 4 lettres) de quelques titres.
  const words = (
    db
      .prepare(
        'SELECT title FROM items WHERE title IS NOT NULL AND length(title) > 6 ORDER BY id LIMIT 400',
      )
      .all() as { title: string }[]
  )
    .map((r) => r.title.split(/[^\p{L}\p{N}]+/u).find((w) => w.length >= 4))
    .filter((w): w is string => Boolean(w))
  const term = words[0] ?? 'image'
  const term2 = words[Math.floor(words.length / 2)] ?? 'photo'
  const collection = db.prepare('SELECT uuid FROM collections LIMIT 1').get() as
    { uuid: string } | undefined
  const out = {
    items,
    terms: [term, term2],
    listFirstPage: timeIt(list({}), runs),
    listNextPage: timeIt(list({ cursor: first.nextCursor }), runs),
    listSaved: timeIt(list({ tab: 'saved' }), runs),
    listUnsorted: timeIt(list({ tab: 'unsorted' }), runs),
    listOldest: timeIt(list({ sort: 'oldest' }), runs),
    listName: timeIt(list({ sort: 'name' }), runs),
    listCollection: collection
      ? timeIt(
          () =>
            listItems(db, {
              scope: 'collection',
              collectionUuid: collection.uuid,
              limit: 100,
            } as never),
          runs,
        )
      : null,
    countersUncached: timeIt(() => {
      invalidateCounts(db)
      return tabCounts(db)
    }, runs),
    ftsWord: timeIt(() => runSearch(db, { q: term, limit: 300 }), runs),
    ftsPrefix: timeIt(() => runSearch(db, { q: term.slice(0, 3), limit: 300 }), runs),
    ftsTwoWords: timeIt(() => runSearch(db, { q: `${term} ${term2}`, limit: 300 }), runs),
    ftsSourceWord: timeIt(() => runSearch(db, { q: 'instagram', limit: 300 }), runs),
    plans: Object.fromEntries(
      Object.entries({
        listRecent: `SELECT i.id FROM items i WHERE i.deleted_at IS NULL AND i.hidden_at IS NULL
                     ORDER BY i.created_at DESC, i.id DESC LIMIT 100`,
        countAll: 'SELECT count(*) FROM items i WHERE i.deleted_at IS NULL AND i.hidden_at IS NULL',
        listSaved: `SELECT i.id FROM items i WHERE i.deleted_at IS NULL AND i.hidden_at IS NULL
                    AND EXISTS (SELECT 1 FROM collection_items c WHERE c.item_id = i.id)
                    ORDER BY i.created_at DESC, i.id DESC LIMIT 100`,
        fts: `SELECT i.id FROM items_fts JOIN items i ON i.id = items_fts.rowid
              WHERE items_fts MATCH 'image' AND i.deleted_at IS NULL LIMIT 300`,
      }).map(([k, sql]) => [
        k,
        (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map(
          (r) => r.detail,
        ),
      ]),
    ),
    maintenance: {} as Record<string, number>,
  }
  db.close()
  // Écritures sur une copie : `PRAGMA optimize` et `wal_checkpoint(TRUNCATE)`.
  const dir = mkdtempSync(join(tmpdir(), 'recolt-bench-q-'))
  try {
    const copy = join(dir, 'recolt.db')
    copyFileSync(dbFile, copy)
    for (const ext of ['-wal', '-shm'])
      if (existsSync(dbFile + ext)) copyFileSync(dbFile + ext, copy + ext)
    const w = new Database(copy)
    w.pragma('journal_mode = WAL')
    let t = performance.now()
    w.pragma('optimize')
    out.maintenance.optimizeMs = Math.round((performance.now() - t) * 100) / 100
    t = performance.now()
    w.pragma('wal_checkpoint(TRUNCATE)')
    out.maintenance.checkpointMs = Math.round((performance.now() - t) * 100) / 100
    w.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { values } = parseArgs({
    options: {
      db: { type: 'string' },
      runs: { type: 'string', default: '50' },
      json: { type: 'string' },
    },
  })
  if (!values.db) {
    console.error('usage : bench-queries.mts --db <recolt.db> [--runs 50] [--json <fichier>]')
    process.exit(2)
  }
  const r = benchQueries(resolve(values.db), Number(values.runs))
  console.log(JSON.stringify(r, null, 2))
  if (values.json) writeFileSync(values.json, JSON.stringify(r, null, 2))
}
