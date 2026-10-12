import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ItemCard } from '../../../src/shared/dto/items'
import fixture from '../../../src/renderer/src/api/mock-items.json'
import { fr } from '../../../src/renderer/src/i18n/fr'

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (typeof v === 'function') {
    const r: unknown = (v as (...a: unknown[]) => unknown)(2, 3, 'x')
    if (typeof r === 'string') out.push(r)
  } else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}

describe('mockup fixture (api/mock.ts)', () => {
  it('60 valid ItemCards, media under recolt:// only', () => {
    const items = z.array(ItemCard).parse(fixture)
    expect(items).toHaveLength(60)
    expect(items.filter((i) => i.kind === 'tweet').length).toBeGreaterThan(0)
    expect(JSON.stringify(fixture)).not.toMatch(/https?:\/\//)
  })
})

describe('French texts', () => {
  const all = strings(fr)
  it('informal "tu" address, no plan banner, no visual search', () => {
    expect(all.length).toBeGreaterThan(200)
    for (const s of all) {
      expect(s, s).not.toMatch(/\b(vous|votre|vos)\b/i)
      expect(s, s).not.toMatch(/upgrade|free plan|plan gratuit/i)
      expect(s, s).not.toMatch(/recherche visuelle/i)
    }
  })
  it('observed labels', () => {
    expect(fr.nav.library).toBe('Bibliothèque')
    expect(fr.tabs.unsorted).toBe('Non classés')
    expect(fr.count.items(1)).toBe('1 élément')
    expect(fr.count.items(0)).toBe('0 élément')
    expect(fr.count.items(36)).toBe('36 éléments')
  })
})
