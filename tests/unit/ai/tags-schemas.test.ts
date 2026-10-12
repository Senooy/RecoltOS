import { describe, expect, it } from 'vitest'
import { AnalysisZ, analysisSchema, analysisZ, decodeTolerant } from '../../../src/main/ai/schemas'
import {
  SEED_TAGS,
  TAG_MAP_EN_FR,
  buildVocabulary,
  filterTags,
  normalizeTag,
} from '../../../src/main/ai/tags'
import { openTestLib } from '../db/helpers'

describe('tags', () => {
  it('normalizeTag', () => {
    expect(normalizeTag('Graphic Design')).toBe('graphic-design')
    expect(normalizeTag('#Jeu Vidéo')).toBe('jeu-video')
    expect(normalizeTag('  Bande   dessinée !')).toBe('bande-dessinee')
    expect(normalizeTag('a'.repeat(40))).toHaveLength(32)
  })

  it('at most 2 tags outside the vocabulary, 6 in total, no stop words or sources', () => {
    const vocab = ['affiche', 'typographie', 'retro', 'interface', 'logo', '3d', 'mode']
    expect(filterTags(['Affiche', 'neuf-1', 'neuf-2', 'neuf-3', 'retro'], vocab)).toEqual([
      'affiche',
      'neuf-1',
      'neuf-2',
      'retro',
    ])
    expect(filterTags(['photo', 'instagram', 'x', 'vidéo', 'affiche', 'affiche'], vocab)).toEqual([
      'affiche',
    ])
    expect(filterTags(vocab, vocab)).toHaveLength(6)
  })

  it('TAG_MAP_EN_FR covers the 16 singletons', () => {
    expect(Object.keys(TAG_MAP_EN_FR)).toHaveLength(16)
    expect(TAG_MAP_EN_FR['graphic-design']).toBe('design-graphique')
  })

  it('vocabulary = seeds + most used tags, 60 at most', () => {
    const t = openTestLib()
    try {
      const { id } = t.repos.items.insert({ kind: 'image' })
      t.repos.tags.addToItems([id], ['Nouveau-Tag', 'affiche'], 'user')
      const v = buildVocabulary(t.db)
      expect(v.slice(0, SEED_TAGS.length)).toEqual([...SEED_TAGS])
      expect(v).toContain('nouveau-tag')
      expect(v.filter((x) => x === 'affiche')).toHaveLength(1)
      expect(v.length).toBeLessThanOrEqual(60)
    } finally {
      t.cleanup()
    }
  })
})

describe('output schemas', () => {
  it('strict schema without bounds', () => {
    const s = analysisSchema()
    expect(s.required).toEqual(['title', 'description', 'tags', 'ocr'])
    expect(s.additionalProperties).toBe(false)
    expect(JSON.stringify(s)).not.toMatch(/minLength|maxItems|maxLength/)
    expect(analysisSchema(['title']).required).toEqual(['title'])
  })

  it('zod clamps instead of rejecting', () => {
    const v = AnalysisZ.parse({
      title: '« Un titre. »',
      description: 'd'.repeat(500),
      tags: Array.from({ length: 12 }, (_, i) => `t${i}`),
      ocr: ' o ',
    })
    expect(v.title).toBe('Un titre')
    expect(v.description).toHaveLength(400)
    expect(v.tags).toHaveLength(8)
    expect(v.ocr).toBe('o')
    expect(AnalysisZ.safeParse({ title: '', description: '', tags: [], ocr: '' }).success).toBe(
      false,
    )
    expect(analysisZ(['title']).parse({ title: 'Seul' }).title).toBe('Seul')
  })

  it('tolerant decoding', () => {
    expect(decodeTolerant('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(decodeTolerant('Voici : {"a":"}{"} merci')).toEqual({ a: '}{' })
    expect(decodeTolerant('{"a":')).toBeUndefined()
    expect(decodeTolerant('rien')).toBeUndefined()
  })
})
