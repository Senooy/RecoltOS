/** Shelf: choice of the played videos and deterministic star field. */
import { describe, expect, it } from 'vitest'
import {
  MAX_PLAYING,
  SHELF_PAD_LEFT,
  SHELF_STEP,
  playingIndices,
} from '../../../src/renderer/src/features/collections/shelf/CollectionShelf'
import { makeStars } from '../../../src/renderer/src/features/collections/shelf/Starfield'
import { X_LOGO_PATH } from '../../../src/renderer/src/components/icons/brand'

describe('playingIndices', () => {
  it('at most MAX_PLAYING video(s), closest to the center', () => {
    const isVideo = Array.from({ length: 17 }, () => true)
    const set = playingIndices(isVideo, 0, 1280)
    expect(set.size).toBe(MAX_PLAYING)
    // Center 640: slots 3 and 4 (centers 579 and 701), then 2 and 5.
    const centers = [...set].map((i) => SHELF_PAD_LEFT + SHELF_STEP * (i + 0.5))
    for (const c of centers) expect(Math.abs(c - 640)).toBeLessThan(250)
  })
  it('ignores covers that are not videos and follows the scrolling', () => {
    const isVideo = [false, true, false, true, true, false, true, true, true]
    const a = playingIndices(isVideo, 0, 1280)
    expect([...a].every((i) => isVideo[i])).toBe(true)
    const b = playingIndices(isVideo, 600, 1280)
    expect(b.has(8)).toBe(true)
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
