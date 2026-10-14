/** Shelf: videos in the window, face texture and deterministic star field. */
import { describe, expect, it } from 'vitest'
import {
  SHELF_PAD_LEFT,
  SHELF_STEP,
  animatedCount,
  faceSrc,
} from '../../../src/renderer/src/features/collections/shelf/CollectionShelf'
import { visibleSlots } from '../../../src/renderer/src/features/collections/shelf/shelf-videos'
import { makeStars } from '../../../src/renderer/src/features/collections/shelf/Starfield'
import { X_LOGO_PATH } from '../../../src/renderer/src/components/icons/brand'

describe('visibleSlots', () => {
  it('slots intersecting the window, following the scrolling', () => {
    const a = visibleSlots(0, 1280, 18, SHELF_PAD_LEFT, SHELF_STEP)
    // (1280 − 152) / 122 → slots 0 to 9.
    expect([...a]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const b = visibleSlots(600, 1280, 18, SHELF_PAD_LEFT, SHELF_STEP)
    expect(b.has(0)).toBe(false)
    expect(b.has(14)).toBe(true)
  })
  it('the slices that fall at entry are the visible ones', () => {
    expect(animatedCount(1280)).toBe(11)
    expect(animatedCount(1280, 4)).toBe(4)
  })
})

describe('faceSrc', () => {
  const base = {
    thumbUrl: 'recolt://default/thumbs/ab/x.webp?v=1',
    largeUrl: 'recolt://default/large/ab/x.webp?v=1',
    posterUrl: null,
  }
  it('800 px thumbnail for portrait sources, large otherwise', () => {
    expect(faceSrc({ ...base, width: 1080, height: 1920 })).toBe(base.thumbUrl)
    expect(faceSrc({ ...base, width: 1920, height: 1080 })).toBe(base.largeUrl)
    expect(faceSrc({ ...base, width: null, height: null })).toBe(base.largeUrl)
  })
})

describe('Starfield', () => {
  it('≈ 220 stars for 1280×820, reproducible draw, radii and opacities bounded', () => {
    const a = makeStars(1280, 820)
    expect(a.length).toBe(220)
    expect(makeStars(1280, 820)).toEqual(a)
    for (const s of a) {
      expect(s.r).toBeGreaterThanOrEqual(0.5)
      expect(s.r).toBeLessThanOrEqual(1.3)
      expect(s.a).toBeGreaterThanOrEqual(0.15)
      expect(s.a).toBeLessThanOrEqual(0.9)
    }
    const twinkling = a.filter((s) => s.twinkle).length / a.length
    expect(twinkling).toBeGreaterThan(0.04)
    expect(twinkling).toBeLessThan(0.18)
  })
})

describe('logo X', () => {
  it('solid shapes (4 closed subpaths), not two crossed strokes', () => {
    expect(X_LOGO_PATH.match(/Z/g)?.length).toBe(4)
  })
})
