import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openTestLib, type TestLib } from './helpers'

let lib: TestLib
beforeEach(() => {
  lib = openTestLib()
})
afterEach(() => lib.cleanup())

const ids = (match: string, sources?: string[]) =>
  lib.repos.search.match(match, sources ? { sources } : {}).map((h) => h.id)

describe('FTS5', () => {
  it('insertion → recherche : « cafe » trouve « café » (remove_diacritics 2)', () => {
    const { items } = lib.repos
    const a = items.insert({ kind: 'image', title: 'Un café à Lyon' }).id
    items.insert({ kind: 'image', title: 'Thé vert' })
    expect(ids('cafe')).toEqual([a])
    expect(ids('CAFÉ')).toEqual([a])
    expect(ids('lyo*')).toEqual([a])
  })

  it('cherche dans notes, OCR, description IA, tags IA, URL et texte de post', () => {
    const { items } = lib.repos
    const post = items.insert({
      kind: 'tweet',
      source: 'x',
      postMeta: {
        v: 1,
        platform: 'x',
        author: { name: 'Ada Lovelace', handle: 'ada', avatarUrl: null },
        text: 'machine analytique',
        url: null,
        postedAt: null,
        media: [],
        quoted: {
          author: { name: 'Babbage', handle: 'cbabbage', avatarUrl: null },
          text: 'moteur',
          url: null,
          media: [],
        },
        thread: [{ text: 'suite du fil', media: [] }],
      },
    }).id
    const other = items.insert({
      kind: 'image',
      notes: 'note perso',
      ocrText: 'texte reconnu',
      aiDescription: 'paysage brumeux',
      aiTags: ['montagne'],
      sourceUrl: 'https://exemple.test/page',
    }).id
    for (const q of ['analytique', 'lovelace', 'ada', 'moteur', 'cbabbage', 'fil']) {
      expect(ids(q), q).toEqual([post])
    }
    for (const q of ['perso', 'reconnu', 'brumeux', 'montagne', 'exemple']) {
      expect(ids(q), q).toEqual([other])
    }
    expect(ids('post_text:ada')).toEqual([post])
  })

  it('mise à jour de titre réindexe ; masqués et supprimés exclus ; filtre de sources', () => {
    const { items } = lib.repos
    const a = items.insert({ kind: 'image', title: 'avant', source: 'instagram' }).id
    const b = items.insert({ kind: 'image', title: 'avant aussi', source: 'x' }).id
    items.update(a, { title: 'après' })
    expect(ids('apres')).toEqual([a])
    expect(ids('avant')).toEqual([b])
    expect(ids('apres', ['x'])).toEqual([])
    expect(ids('apres', ['instagram', 'x'])).toEqual([a])
    items.setHidden([a], true)
    expect(ids('apres')).toEqual([])
    items.setHidden([a], false)
    items.trash([a])
    expect(ids('apres')).toEqual([])
  })

  it('renommage de tag réindexe les items liés', () => {
    const { items, tags, search } = lib.repos
    const a = items.insert({ kind: 'image', title: 'photo' }).id
    const [tagId] = tags.addToItems([a], ['vacances'])
    expect(ids('tags:vacances')).toEqual([a])
    tags.rename(tagId!, 'Été 2026')
    expect(ids('tags:vacances')).toEqual([])
    expect(ids('tags:ete')).toEqual([a])
    expect(ids('"ete-2026"')).toEqual([a])
    tags.removeFromItems([a], [tagId!])
    expect(ids('tags:ete')).toEqual([])
    expect(search.indexedCount()).toBe(1)
  })

  it('purge sans ligne FTS fantôme (cascade item_tags + trigger)', () => {
    const { items, tags, search, collections } = lib.repos
    const a = items.insert({ kind: 'image', title: 'fantome' }).id
    const b = items.insert({ kind: 'image', title: 'vivant' }).id
    tags.addToItems([a, b], ['commun'])
    const c = collections.create({ name: 'C' }).id
    collections.addItems(c, [a])
    items.purge([a])
    expect(search.indexedCount()).toBe(1)
    expect(lib.db.prepare('SELECT rowid FROM items_fts').all()).toEqual([{ rowid: b }])
    expect(
      lib.db.prepare("SELECT rowid FROM items_fts WHERE items_fts MATCH 'fantome'").all(),
    ).toEqual([])
    expect(ids('commun')).toEqual([b])
  })

  it('reconstruction, optimize et requête invalide', () => {
    const { items, search } = lib.repos
    const a = items.insert({ kind: 'image', title: 'alpha' }).id
    lib.db.prepare('DELETE FROM items_fts').run()
    expect(ids('alpha')).toEqual([])
    expect(search.rebuild()).toBe(1)
    expect(ids('alpha')).toEqual([a])
    search.optimize()
    expect(() => search.match('"non fermé')).toThrow(
      expect.objectContaining({ code: 'validation' }),
    )
    expect(() => search.match('inconnue:x')).toThrow(
      expect.objectContaining({ code: 'validation' }),
    )
  })

  it('classement bm25 : un titre pèse plus qu’une URL', () => {
    const { items } = lib.repos
    const inUrl = items.insert({ kind: 'url', sourceUrl: 'https://exemple.test/zebre' }).id
    const inTitle = items.insert({ kind: 'image', title: 'zebre' }).id
    expect(ids('zebre')).toEqual([inTitle, inUrl])
    expect(lib.repos.search.match('zebre', { limit: 1 })).toHaveLength(1)
  })

  it('historique de recherche', () => {
    const { search } = lib.repos
    lib.clock.now = 10
    search.addHistory('  chat ')
    lib.clock.now = 20
    search.addHistory('chien')
    lib.clock.now = 30
    search.addHistory('CHAT')
    search.addHistory('   ')
    expect(search.listHistory()).toEqual([
      { query: 'chat', usedAt: 30, uses: 2 },
      { query: 'chien', usedAt: 20, uses: 1 },
    ])
    expect(search.clearHistory()).toBe(2)
  })
})

describe('EXPLAIN QUERY PLAN : index partiels ix_items_live_*', () => {
  const plan = (sql: string) =>
    (lib.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[])
      .map((r) => r.detail)
      .join(' | ')
  const live = 'deleted_at IS NULL AND hidden_at IS NULL'

  it.each([
    [
      'récents',
      `SELECT id FROM items WHERE ${live} ORDER BY created_at DESC, id DESC LIMIT 60`,
      'ix_items_live_created',
    ],
    [
      'keyset',
      `SELECT id FROM items WHERE ${live} AND (created_at, id) < (1, 1) ORDER BY created_at DESC, id DESC LIMIT 60`,
      'ix_items_live_created',
    ],
    [
      'nom',
      `SELECT id FROM items WHERE ${live} ORDER BY name_key, id LIMIT 60`,
      'ix_items_live_name',
    ],
    [
      'couleur',
      `SELECT id FROM items WHERE ${live} ORDER BY color_key, id LIMIT 60`,
      'ix_items_live_color',
    ],
    [
      'type',
      `SELECT id FROM items WHERE ${live} AND kind = 'video' ORDER BY created_at DESC LIMIT 60`,
      'ix_items_live_kind',
    ],
    [
      'source',
      `SELECT id FROM items WHERE ${live} AND source = 'x' ORDER BY created_at DESC LIMIT 60`,
      'ix_items_live_source',
    ],
  ])('%s', (_label, sql, index) => {
    for (let n = 0; n < 50; n++) lib.repos.items.insert({ kind: 'image', title: `t${n}` })
    lib.db.exec('ANALYZE')
    const detail = plan(sql)
    expect(detail).toContain(index)
    expect(detail).not.toContain('USE TEMP B-TREE')
  })
})
