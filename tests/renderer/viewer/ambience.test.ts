import { describe, expect, it } from 'vitest'
import {
  AMBIENCE_MAX_LUMINANCE,
  AMBIENCE_MEAN_LUMINANCE,
  GLASS_ALPHA,
  TINT_MAX_LUMINANCE,
  averageColor,
  contrast,
  coverCrop,
  darkenFactor,
  luminance,
  luminanceStats,
  over,
  parseHex,
  tintFrom,
  tintVars,
  toHex,
  type Rgb,
} from '../../../src/renderer/src/features/viewer/ambience-engine'

/** Gray of relative luminance `l`. */
function grayOf(l: number): Rgb {
  let lo = 0
  let hi = 255
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2
    if (luminance([m, m, m]) < l) lo = m
    else hi = m
  }
  return [lo, lo, lo]
}

const SAMPLES: Rgb[] = [
  [255, 255, 255],
  [0, 0, 0],
  [26, 111, 120],
  [214, 108, 52],
  [255, 236, 0],
  [40, 90, 255],
  [255, 0, 128],
  [128, 128, 128],
]

describe('detail view ambience: colors', () => {
  it('hex round trip', () => {
    expect(parseHex('#1a6f78')).toEqual([26, 111, 120])
    expect(parseHex('nope')).toBeNull()
    expect(toHex([26, 111, 120])).toBe('#1a6f78')
  })

  it('saturation-weighted average: the color dominates the whites', () => {
    const px: number[] = []
    for (let i = 0; i < 8; i++) px.push(255, 255, 255, 255)
    for (let i = 0; i < 2; i++) px.push(20, 120, 130, 255)
    const [r, g, b] = averageColor(px)!
    // Without weighting, the average would be ≈ (208, 228, 230).
    expect(g - r).toBeGreaterThan(60)
    expect(b).toBeGreaterThan(r)
    expect(averageColor([0, 0, 0, 0])).toBeNull()
  })

  it('dark tinted surface, luminance-bounded, whatever the color', () => {
    for (const c of SAMPLES) {
      const t = tintFrom(c)
      expect(luminance(t.surface)).toBeLessThanOrEqual(TINT_MAX_LUMINANCE + 1e-6)
      expect(luminance(t.solid)).toBeLessThanOrEqual(luminance(t.surface) + 1e-6)
    }
    // A teal media keeps a teal surface.
    const [r, g, b] = tintFrom([26, 111, 120]).surface
    expect(g).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(r)
  })

  it('secondary AA texts (≥ 4.5:1) on the glass over the lightest ambience', () => {
    const muted: Rgb = [0xab, 0xab, 0xae]
    const fg: Rgb = [0xee, 0xec, 0xed]
    const ambience = grayOf(AMBIENCE_MAX_LUMINANCE)
    for (const c of SAMPLES) {
      const glass = over(tintFrom(c).surface, GLASS_ALPHA, ambience)
      expect(contrast(muted, glass)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(fg, glass)).toBeGreaterThanOrEqual(7)
    }
  })

  it('white icons readable on the ambience (≥ 4.5:1 at the ceiling)', () => {
    expect(contrast([255, 255, 255], grayOf(AMBIENCE_MAX_LUMINANCE))).toBeGreaterThanOrEqual(4.5)
  })

  it('darkening: brings maximum and average under their ceilings', () => {
    expect(darkenFactor({ max: 0.05, mean: 0.02 })).toBe(1)
    const k = darkenFactor({ max: 1, mean: 0.8 })
    expect(k).toBeLessThan(1)
    // Luminance follows ≈ k^2.2.
    expect(0.8 * k ** 2.2).toBeLessThanOrEqual(AMBIENCE_MEAN_LUMINANCE * 1.05)
    expect(1 * k ** 2.2).toBeLessThanOrEqual(AMBIENCE_MAX_LUMINANCE * 1.05)
    const stats = luminanceStats([255, 255, 255, 255, 0, 0, 0, 255])
    expect(stats.max).toBeCloseTo(1)
    expect(stats.mean).toBeCloseTo(0.5)
  })

  it('local CSS variables', () => {
    const vars = tintVars(tintFrom([214, 108, 52]))
    expect(Object.keys(vars).sort()).toEqual([
      '--viewer-tint',
      '--viewer-tint-glow',
      '--viewer-tint-solid',
      '--viewer-tint-strong',
    ])
    expect(vars['--viewer-tint']).toMatch(/^rgba\(\d+, \d+, \d+, 0\.72\)$/)
  })

  it('centered cover crop', () => {
    expect(coverCrop(200, 100, 10, 10)).toEqual([50, 0, 100, 100])
    expect(coverCrop(100, 100, 20, 10)).toEqual([0, 25, 100, 50])
  })
})
