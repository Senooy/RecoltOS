import { describe, expect, it } from 'vitest'
import { PostMetaSchema } from '../../src/shared/post-meta'
import {
  REFERENCE_COLLECTIONS,
  REFERENCE_COUNT,
  REFERENCE_DISTRIBUTION,
  liveItems,
  makeSyntheticLibrary,
  scaleCounts,
} from './synthetic-items'

describe('synthetic-items', () => {
  const lib = makeSyntheticLibrary()

  it('408 éléments dont 54 posts texte, répartition de la photo de référence', () => {
    expect(REFERENCE_DISTRIBUTION.reduce((a, d) => a + d.n, 0)).toBe(REFERENCE_COUNT)
    expect(lib.items).toHaveLength(408)
    expect(lib.items.filter((i) => i.kind === 'tweet')).toHaveLength(54)
    for (const d of REFERENCE_DISTRIBUTION) {
      const n = lib.items.filter((i) => i.kind === d.kind && i.source === d.source).length
      expect(n, `${d.kind}/${d.source}`).toBe(d.n)
    }
  })

  it('est déterministe et sensible à la graine', () => {
    expect(makeSyntheticLibrary()).toEqual(lib)
    expect(makeSyntheticLibrary({ seed: 7 }).items[0]?.uuid).not.toBe(lib.items[0]?.uuid)
  })

  it('uuid uniques, dates décroissantes dans la fenêtre 30/06 → 24/09/2026', () => {
    expect(new Set(lib.items.map((i) => i.uuid)).size).toBe(408)
    const min = Date.UTC(2026, 5, 29)
    const max = Date.UTC(2026, 8, 25)
    for (const it of lib.items) {
      expect(it.createdAt).toBeGreaterThan(min)
      expect(it.createdAt).toBeLessThan(max)
    }
  })

  it('les post_meta passent PostMetaSchema v1 et ne contiennent que des URL factices', () => {
    const withMeta = lib.items.filter((i) => i.postMeta)
    expect(withMeta.length).toBeGreaterThanOrEqual(54)
    for (const it of withMeta) {
      expect(PostMetaSchema.safeParse(it.postMeta).success, it.uuid).toBe(true)
    }
    const urls = JSON.stringify(lib).match(/https?:\/\/[^"\\ ]+/g) ?? []
    expect(urls.length).toBeGreaterThan(100)
    for (const u of urls) expect(u.startsWith('https://example.test/'), u).toBe(true)
  })

  it('palette : tous sauf les vidéos (ERRATA §C) ; bucket inconnu sans palette', () => {
    for (const it of lib.items) {
      if (it.kind === 'video' || it.kind === 'url') {
        expect(it.palette).toBeNull()
        expect(it.colorBucket).toBe(13)
      } else {
        expect(it.palette?.length).toBeGreaterThanOrEqual(3)
        expect(it.colorBucket).toBeLessThanOrEqual(12)
      }
    }
  })

  it('17 collections ; 252 appartenances à 408 (≤ 250 éléments distincts)', () => {
    expect(lib.collections).toHaveLength(REFERENCE_COLLECTIONS.length)
    const all = lib.collections.flatMap((c) => c.itemIndexes)
    expect(new Set(all).size).toBeLessThanOrEqual(250)
    expect(all.length).toBeGreaterThan(200)
  })

  it('corbeille et masqués optionnels, jamais en collection', () => {
    const l = makeSyntheticLibrary({ trashed: 9, hidden: 1 })
    expect(liveItems(l)).toHaveLength(408)
    expect(l.items.filter((i) => i.trashedAt !== null)).toHaveLength(9)
    expect(l.items.filter((i) => i.hiddenAt !== null)).toHaveLength(1)
    const member = new Set(l.collections.flatMap((c) => c.itemIndexes))
    for (const it of l.items)
      if (it.trashedAt || it.hiddenAt) expect(member.has(it.index)).toBe(false)
  })

  it('count configurable (banc de perf) et somme exacte', () => {
    expect(scaleCounts([1, 1, 1], 10).reduce((a, b) => a + b, 0)).toBe(10)
    expect(makeSyntheticLibrary({ count: 1000 }).items).toHaveLength(1000)
  })
})
