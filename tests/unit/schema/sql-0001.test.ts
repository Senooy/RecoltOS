import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SQL = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../../src/main/db/migrations/0001_init.sql'),
  'utf8',
)
let db: Database.Database
const now = 1_790_000_000_000
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function addItem(n: number, fields: Record<string, unknown> = {}): number {
  const cols = { uuid: uuid(n), kind: 'image', created_at: now, updated_at: now, ...fields }
  const keys = Object.keys(cols)
  const r = db
    .prepare(`INSERT INTO items(${keys.join(',')}) VALUES (${keys.map((k) => `@${k}`).join(',')})`)
    .run(cols)
  return Number(r.lastInsertRowid)
}
const match = (q: string) =>
  db
    .prepare('SELECT rowid FROM items_fts WHERE items_fts MATCH ? ORDER BY rowid')
    .all(q)
    .map((r) => (r as { rowid: number }).rowid)

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.transaction(() => {
    db.exec(SQL)
    db.pragma('user_version = 1')
  })()
})
afterEach(() => db.close())

describe('0001_init.sql', () => {
  it('applies, user_version = 1, integrity ok', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('contains the expected tables and no item_embeddings', () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as {
        name: string
      }[]
    ).map((r) => r.name)
    for (const t of [
      'authors',
      'items',
      'item_media',
      'collections',
      'collection_items',
      'tags',
      'item_tags',
      'spaces',
      'space_nodes',
      'jobs',
      'ai_batches',
      'ai_calls',
      'rediscover_log',
      'sync_state',
      'sync_runs',
      'sync_items',
      'sync_dismissed',
      'import_runs',
      'import_tombstones',
      'settings',
      'search_history',
      'items_fts',
      'items_fts_src',
    ]) {
      expect(tables, t).toContain(t)
    }
    for (const t of ['item_embeddings', 'saves', 'ai_jobs', 'download_jobs', 'dismissed_items'])
      expect(tables).not.toContain(t)
    const cols = (t: string) =>
      (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name)
    expect(cols('items')).toEqual(
      expect.arrayContaining(['palette_weights', 'ai_lang', 'ai_excluded', 'origin_id']),
    )
    expect(cols('item_media')).toEqual(
      expect.arrayContaining(['large_rel', 'preview_rel', 'legacy_thumb_rel']),
    )
    expect(cols('authors')).toContain('sample_external_id')
    expect(cols('collections')).toContain('ai_excluded')
    expect(cols('spaces')).toContain('thumb_updated_at')
    expect(cols('jobs')).toEqual(expect.arrayContaining(['batch_id', 'provider']))
    expect(cols('sync_state')[0]).toBe('source')
  })

  it('FTS5: diacritics, prefixes, tags, purge with no ghost row', () => {
    const a = addItem(1, { title: 'Café crème' })
    const b = addItem(2, {
      kind: 'tweet',
      source: 'x',
      post_meta: JSON.stringify({
        v: 1,
        platform: 'x',
        author: { name: 'Léa', handle: 'lea_d', avatarUrl: null },
        text: 'Typographie suisse',
        url: null,
        postedAt: null,
        thread: [{ text: 'Grille modulaire', media: [] }],
      }),
    })
    expect(match('cafe')).toEqual([a])
    expect(match('"typo"*')).toEqual([b])
    expect(match('modulaire')).toEqual([b])
    expect(match('post_text:"lea_d"')).toEqual([b])
    db.prepare('INSERT INTO tags(uuid,name,created_at) VALUES (?,?,?)').run(
      uuid(100),
      'minimal',
      now,
    )
    db.prepare('INSERT INTO item_tags(item_id,tag_id,created_at) VALUES (?,1,?)').run(a, now)
    expect(match('tags:minimal')).toEqual([a])
    db.prepare("UPDATE tags SET name='epure' WHERE id=1").run()
    expect(match('tags:epure')).toEqual([a])
    db.prepare('DELETE FROM items WHERE id=?').run(a)
    expect(db.prepare('SELECT count(*) c FROM items_fts').get()).toEqual({ c: 1 })
  })

  it('GatherOS tombstones', () => {
    const i = addItem(3, { origin: 'gatheros', origin_id: 'save-1' })
    db.prepare(
      'INSERT INTO collections(uuid,name,origin,origin_id,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    ).run(uuid(200), 'Dev', 'gatheros', 'col-1', now, now)
    db.prepare('INSERT INTO collection_items(collection_id,item_id,added_at) VALUES (1,?,?)').run(
      i,
      now,
    )
    db.prepare('DELETE FROM collection_items').run()
    db.prepare('DELETE FROM items').run()
    db.prepare('DELETE FROM collections').run()
    const t = db.prepare('SELECT entity, origin_id FROM import_tombstones ORDER BY entity').all()
    expect(t).toEqual([
      { entity: 'collection', origin_id: 'col-1' },
      { entity: 'item', origin_id: 'save-1' },
      { entity: 'membership', origin_id: 'col-1:save-1' },
    ])
  })

  it('constraints: node ≥ 24, job type, color bucket, cascade and SET NULL', () => {
    db.prepare('INSERT INTO spaces(uuid,created_at,updated_at) VALUES (?,?,?)').run(
      uuid(300),
      now,
      now,
    )
    const node = db.prepare(
      'INSERT INTO space_nodes(uuid,space_id,type,item_id,x,y,width,height,created_at,updated_at) VALUES (?,1,?,?,0,0,?,?,?,?)',
    )
    expect(() => node.run(uuid(301), 'note', null, 23, 100, now, now)).toThrow(/CHECK/)
    expect(() => node.run(uuid(302), 'frame', null, 100, 100, now, now)).toThrow(/CHECK/)
    const it = addItem(4)
    node.run(uuid(303), 'item', it, 100, 100, now, now)
    db.prepare('DELETE FROM items WHERE id=?').run(it)
    expect(db.prepare('SELECT item_id FROM space_nodes WHERE uuid=?').get(uuid(303))).toEqual({
      item_id: null,
    })
    const job = db.prepare('INSERT INTO jobs(type,created_at,updated_at) VALUES (?,?,?)')
    expect(() => job.run('embed.item', now, now)).toThrow(/CHECK/)
    job.run('media.derive', now, now)
    const unknown = addItem(5)
    expect(db.prepare('SELECT color_bucket, color_key FROM items WHERE id=?').get(unknown)).toEqual(
      { color_bucket: 13, color_key: 13100 },
    )
  })

  it('partial list indexes are used', () => {
    const plan = db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT id FROM items WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 120',
      )
      .all() as { detail: string }[]
    expect(plan.map((p) => p.detail).join(' ')).toMatch(/ix_items_live_created/)
  })

  it('post_meta.thread not an object (string, array of strings): INSERT, UPDATE and rebuild do not throw', () => {
    expect(() => addItem(30, { post_meta: '{"v":1,"thread":"x"}' })).not.toThrow()
    expect(() => addItem(31, { post_meta: '{"v":1,"thread":["a"]}' })).not.toThrow()
    const mixed = addItem(32, {
      kind: 'tweet',
      post_meta: JSON.stringify({ v: 1, thread: ['pas un objet', { text: 'Fil valide' }] }),
    })
    expect(() =>
      db.prepare('UPDATE items SET post_meta = ? WHERE id = ?').run('{"thread":["a"]}', mixed),
    ).not.toThrow()
    expect(() =>
      db.exec(`DELETE FROM items_fts;
        INSERT INTO items_fts(rowid,title,notes,post_text,ocr_text,ai_text,tags,url)
        SELECT item_id,title,notes,post_text,ocr_text,ai_text,tags,url FROM items_fts_src;`),
    ).not.toThrow()
    expect(match('valide')).toEqual([])
    db.prepare('UPDATE items SET post_meta = ? WHERE id = ?').run(
      JSON.stringify({ v: 1, thread: [{ text: 'Fil valide' }] }),
      mixed,
    )
    expect(match('valide')).toEqual([mixed])
  })
})
