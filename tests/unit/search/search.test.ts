/** traduction de la requête, recherche FTS + filtres, suggestions, performance. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSearch, suggest } from '../../../src/main/search/search'
import { toFtsQuery } from '../../../src/shared/search-query'
import { openTestLib, type TestLib } from '../db/helpers'
import { seedSyntheticLibrary } from '../../helpers/db'
import { makeSyntheticLibrary } from '../../helpers/synthetic-items'

describe('toFtsQuery', () => {
  it('termes préfixés, ET implicite, guillemets échappés', () => {
    expect(toFtsQuery('dark moody ui').match).toBe('"dark"* "moody"* "ui"*')
    expect(toFtsQuery('"une phrase" exacte').match).toBe('"une phrase" "exacte"*')
    expect(toFtsQuery('a"b').match).toBe('"a"b"*'.replace('a"b', 'a""b'))
    expect(toFtsQuery('   ').match).toBeNull()
  })
  it('chips de source, tags, handles, types, couleur', () => {
    const p = toFtsQuery(
      '#instagram #bookmark #Vacances @ada type:video source:cosmos couleur:#FF3B30',
    )
    expect(p.sources).toEqual(['instagram', 'x', 'cosmos'])
    expect(p.tags).toEqual(['Vacances'])
    expect(p.handles).toEqual(['ada'])
    expect(p.kinds).toEqual(['video'])
    expect(p.color).toBe('#ff3b30')
    expect(p.match).toBe('tags:"Vacances"* post_text:"ada"')
  })
  it('mot nu égal à une source : terme FTS + source notée', () => {
    const p = toFtsQuery('instagram')
    expect(p.match).toBe('"instagram"*')
    expect(p.sourceWords).toEqual(['instagram'])
  })
})

describe('runSearch', () => {
  let lib: TestLib
  beforeEach(() => {
    lib = openTestLib()
  })
  afterEach(() => lib.cleanup())

  const titles = (q: string, filters?: Parameters<typeof runSearch>[1]['filters']) =>
    runSearch(lib.db, { q, filters, limit: 300 }).rows.map((r) => r.title)

  it('« cafe » trouve « café » ; corbeille et masqués exclus', () => {
    const { items } = lib.repos
    items.insert({ kind: 'image', title: 'Un café à Lyon' })
    const t = items.insert({ kind: 'image', title: 'café supprimé' }).id
    const h = items.insert({ kind: 'image', title: 'café masqué' }).id
    items.trash([t])
    items.setHidden([h], true)
    expect(titles('cafe')).toEqual(['Un café à Lyon'])
  })

  it('« instagram » : éléments Instagram en tête, puis les mentions ; #cosmos filtre', () => {
    const { items } = lib.repos
    for (let i = 0; i < 3; i++)
      items.insert({ kind: 'image', title: `photo ${i}`, source: 'instagram' })
    items.insert({ kind: 'image', title: 'capture de mon instagram', source: 'local' })
    items.insert({ kind: 'image', title: 'cosmos 1', source: 'cosmos' })
    items.insert({ kind: 'image', title: 'autre', source: 'cosmos' })
    const r = runSearch(lib.db, { q: 'instagram', limit: 300 })
    expect(r.total).toBe(4)
    expect(r.rows.slice(0, 3).every((x) => x.source === 'instagram')).toBe(true)
    expect(r.rows[3]!.title).toBe('capture de mon instagram')
    const c = runSearch(lib.db, { q: '#cosmos', limit: 300 })
    expect(c.total).toBe(2)
    expect(c.rows.every((x) => x.source === 'cosmos')).toBe(true)
  })

  it('@handle cible l’auteur ; #tag cible les tags ; filtres de type et de période', () => {
    const { items, tags } = lib.repos
    const meta = (handle: string, text: string) => ({
      v: 1 as const,
      platform: 'x' as const,
      author: { name: handle, handle, avatarUrl: null },
      text,
      url: null,
      postedAt: null,
      media: [],
      quoted: null,
      thread: [],
    })
    items.insert({ kind: 'tweet', source: 'x', title: 'a', postMeta: meta('ada', 'bonjour') })
    items.insert({ kind: 'tweet', source: 'x', title: 'b', postMeta: meta('bob', 'salut @ada') })
    const img = items.insert({ kind: 'image', title: 'c' }).id
    tags.addToItems([img], ['vacances'])
    expect(titles('@ada').sort()).toEqual(['a', 'b'])
    expect(titles('#vacances')).toEqual(['c'])
    expect(titles('', { kinds: ['image'] })).toEqual(['c'])
    expect(titles('type:post').sort()).toEqual(['a', 'b'])
    lib.clock.now += 10
    expect(titles('', { period: { from: lib.clock.now, to: null } })).toEqual([])
  })

  it('filtre couleur (ΔE2000, PaletteIndex) : éléments sans palette exclus et comptés', () => {
    const { items } = lib.repos
    items.insert({ kind: 'image', title: 'rouge', palette: ['#fe3a2f', '#ffffff'] } as never)
    items.insert({ kind: 'image', title: 'bleu', palette: ['#1040ff'] } as never)
    items.insert({ kind: 'video', title: 'sans' })
    const r = runSearch(lib.db, { q: '', filters: { color: '#ff3b30' }, limit: 50 })
    expect(r.rows.map((x) => x.title)).toEqual(['rouge'])
    expect(r.noPalette).toBe(1)
  })

  it('suggestions : tags et collections par nom', () => {
    const { items, tags, collections } = lib.repos
    const a = items.insert({ kind: 'image', title: 'x' }).id
    tags.addToItems([a], ['design', 'graphic-design'])
    collections.create({ name: 'Graphic Design' })
    const s = suggest(lib.db, 'des')
    expect(s.tags.map((t) => t.name)).toEqual(['design', 'graphic-design'])
    expect(s.collections.map((c) => c.name)).toEqual(['Graphic Design'])
  })

  it('FTS < 30 ms sur 10 000 lignes synthétiques', () => {
    seedSyntheticLibrary(lib.db, makeSyntheticLibrary({ count: 10_000 }))
    lib.repos.search.rebuild()
    runSearch(lib.db, { q: 'lumière', limit: 300 }) // préchauffage
    const times: number[] = []
    for (const q of ['lumière', 'design ville', 'a', 'instagram', '#x photo']) {
      const t0 = performance.now()
      runSearch(lib.db, { q, limit: 300 })
      times.push(performance.now() - t0)
    }
    times.sort((x, y) => x - y)
    expect(times[Math.floor(times.length / 2)]!).toBeLessThan(30)
  })
})
