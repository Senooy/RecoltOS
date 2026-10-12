/** variante d'image de la toile choisie explicitement, et caches bornés. */
import { describe, expect, it } from 'vitest'
import {
  THUMB_UPSCALE,
  THUMB_W,
  pickSpaceVariant,
} from '../../../src/renderer/src/features/spaces/editor/nodes/MediaNodes'
import { lodOf } from '../../../src/renderer/src/features/spaces/editor/NodeView'
import { lruSet } from '../../../src/renderer/src/lib/lru'

const thumb = 'recolt://lib/thumbs/ab/abc.webp?v=1'
const large = 'recolt://lib/large/ab/abc.webp?v=1'

describe('pickSpaceVariant', () => {
  it('vignette 800w tant qu’elle suffit, large au-delà, jamais l’original', () => {
    expect(pickSpaceVariant(thumb, large, 64)).toBe(thumb)
    // Nœud de 320 px à 100 % en Retina : 640 px physiques.
    expect(pickSpaceVariant(thumb, large, 320 * lodOf(1, 2))).toBe(thumb)
    // À 150 % en Retina (palier 3) : 960 px, tolérance d'agrandissement de la vignette.
    expect(pickSpaceVariant(thumb, large, 320 * lodOf(1.5, 2))).toBe(thumb)
    expect(pickSpaceVariant(thumb, large, THUMB_W * THUMB_UPSCALE + 1)).toBe(large)
    expect(pickSpaceVariant(thumb, large, 320 * lodOf(2, 2))).toBe(large)
  })

  it('une vignette non dérivée (repli) cède la place à large ; sans large, la vignette', () => {
    const legacy = 'recolt://lib/items/ab/legacy.jpg?v=1'
    expect(pickSpaceVariant(legacy, large, 64)).toBe(large)
    expect(pickSpaceVariant(thumb, undefined, 4000)).toBe(thumb)
    expect(pickSpaceVariant(undefined, large, 64)).toBe(large)
    expect(pickSpaceVariant(undefined, undefined, 64)).toBeUndefined()
  })
})

describe('lruSet', () => {
  it('borne la Map et évince la plus ancienne entrée', () => {
    const m = new Map<string, number>()
    for (let i = 0; i < 5; i++) lruSet(m, `k${i}`, i, 3)
    expect([...m.keys()]).toEqual(['k2', 'k3', 'k4'])
    lruSet(m, 'k2', 20, 3)
    lruSet(m, 'k5', 5, 3)
    expect([...m.keys()]).toEqual(['k4', 'k2', 'k5'])
  })
})
