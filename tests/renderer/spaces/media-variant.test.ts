/** Canvas image variant chosen explicitly, and bounded caches. */
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
  it('800w thumbnail while it suffices, large beyond that, never the original', () => {
    expect(pickSpaceVariant(thumb, large, 64)).toBe(thumb)
    // 320 px node at 100 % on Retina: 640 physical px.
    expect(pickSpaceVariant(thumb, large, 320 * lodOf(1, 2))).toBe(thumb)
    // At 150 % on Retina (tier 3): 960 px, thumbnail upscaling tolerance.
    expect(pickSpaceVariant(thumb, large, 320 * lodOf(1.5, 2))).toBe(thumb)
    expect(pickSpaceVariant(thumb, large, THUMB_W * THUMB_UPSCALE + 1)).toBe(large)
    expect(pickSpaceVariant(thumb, large, 320 * lodOf(2, 2))).toBe(large)
  })

  it('a non-derived thumbnail (fallback) yields to large; without large, the thumbnail', () => {
    const legacy = 'recolt://lib/items/ab/legacy.jpg?v=1'
    expect(pickSpaceVariant(legacy, large, 64)).toBe(large)
    expect(pickSpaceVariant(thumb, undefined, 4000)).toBe(thumb)
    expect(pickSpaceVariant(undefined, large, 64)).toBe(large)
    expect(pickSpaceVariant(undefined, undefined, 64)).toBeUndefined()
  })
})

describe('lruSet', () => {
  it('bounds the Map and evicts the oldest entry', () => {
    const m = new Map<string, number>()
    for (let i = 0; i < 5; i++) lruSet(m, `k${i}`, i, 3)
    expect([...m.keys()]).toEqual(['k2', 'k3', 'k4'])
    lruSet(m, 'k2', 20, 3)
    lruSet(m, 'k5', 5, 3)
    expect([...m.keys()]).toEqual(['k4', 'k2', 'k5'])
  })
})
