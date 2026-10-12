/**
 * Criterion 3: deterministic k-means++ Lab palette on a webp thumbnail,
 * 1 to 8 colors, `palette_lab[i] ≈ hexToLab(palette[i])` within 0.05.
 */
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deltaE76, hexToLab } from '../../../src/shared/color'
import {
  kmeansLab,
  mergeClusters,
  mulberry32,
  palette,
  paletteFromRgba,
} from '../../../src/main/workers/media/palette'
import { makeThumb } from '../../../src/main/workers/media/thumbs'
import {
  BLOCK_COLORS,
  generateMediaFixtures,
  type MediaFixtures,
} from '../../fixtures/media/generate'
import { TOOLS, makeTmp } from './helpers'

let fx: MediaFixtures
const tmp = makeTmp()

beforeAll(async () => {
  fx = await generateMediaFixtures(join(tmp.dir, 'fx'))
}, 60_000)
afterAll(() => tmp.cleanup())

function expectWellFormed(p: {
  hex: string[]
  lab: [number, number, number][]
  share: number[]
}): void {
  expect(p.hex.length).toBeGreaterThanOrEqual(1)
  expect(p.hex.length).toBeLessThanOrEqual(8)
  expect(p.lab).toHaveLength(p.hex.length)
  expect(p.share).toHaveLength(p.hex.length)
  for (let i = 0; i < p.hex.length; i++) {
    expect(p.hex[i]).toMatch(/^#[0-9a-f]{6}$/)
    const ref = hexToLab(p.hex[i]!)
    const lab = p.lab[i]!
    for (let c = 0; c < 3; c++) expect(Math.abs(lab[c]! - ref[c]!)).toBeLessThanOrEqual(0.05)
    // Rounded to 4 decimals.
    for (const v of lab) expect(Math.round(v * 1e4) / 1e4).toBe(v)
  }
  // Dominance order, normalized shares.
  for (let i = 1; i < p.share.length; i++) expect(p.share[i]!).toBeLessThanOrEqual(p.share[i - 1]!)
  const sum = p.share.reduce((s, v) => s + v, 0)
  expect(Math.abs(sum - 1)).toBeLessThan(0.002)
  for (const s of p.share) expect(s).toBeGreaterThanOrEqual(0.01)
  // After merging, two colors stay separated by at least ~ΔE76 8 (quantization tolerance).
  for (let i = 0; i < p.lab.length; i++) {
    for (let j = i + 1; j < p.lab.length; j++) {
      expect(deltaE76(p.lab[i]!, p.lab[j]!)).toBeGreaterThan(7)
    }
  }
}

describe('palette on a webp thumbnail', () => {
  it('deterministic, 1 to 8 colors, Lab consistent with the hex within 0.05', async () => {
    const thumb = join(tmp.dir, 'thumbs', 'blocks.webp')
    await makeThumb({ src: fx.blocksWebp, dst: thumb, width: 800 }, TOOLS)
    const a = await palette({ src: thumb }, TOOLS)
    const b = await palette({ src: thumb, k: 8 }, TOOLS)
    expect(b).toEqual(a)
    expectWellFormed(a)
    // The 4 bands are the 4 dominant colors, in width order; the rest = transitions
    // of the 64 px reduction (≈ 1.6 % each, above the 1 % threshold).
    BLOCK_COLORS.forEach((hex, i) => {
      expect(deltaE76(a.lab[i]!, hexToLab(hex))).toBeLessThan(3)
    })
    expect(a.share.slice(0, 4).reduce((s, v) => s + v, 0)).toBeGreaterThan(0.9)
    for (const s of a.share.slice(4)) expect(s).toBeLessThan(0.03)
    expect(a.share[0]!).toBeGreaterThan(0.4)
  })

  it('synthetic gradient photo: well formed and stable', async () => {
    const W = 200
    const H = 120
    const raw = Buffer.alloc(W * H * 3)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 3
        raw[o] = Math.round((x / W) * 255)
        raw[o + 1] = Math.round((y / H) * 200)
        raw[o + 2] = 128
      }
    }
    const src = join(tmp.dir, 'grad.webp')
    await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
      .webp({ quality: 80 })
      .toFile(src)
    const runs = await Promise.all([1, 2, 3].map(() => palette({ src }, TOOLS)))
    expect(runs[1]).toEqual(runs[0])
    expect(runs[2]).toEqual(runs[0])
    expectWellFormed(runs[0]!)
  })

  it('transparent pixels ignored; fully transparent image → empty palette', async () => {
    const W = 40
    const half = Buffer.alloc(W * W * 4)
    for (let i = 0; i < W * W; i++) {
      const left = i % W < W / 2
      half.set(left ? [255, 0, 0, 255] : [0, 0, 255, 10], i * 4)
    }
    const src = join(tmp.dir, 'half.png')
    await sharp(half, { raw: { width: W, height: W, channels: 4 } })
      .png()
      .toFile(src)
    const p = await palette({ src }, TOOLS)
    expect(p.hex).toEqual(['#ff0000'])
    expect(p.share).toEqual([1])

    const clear = Buffer.alloc(W * W * 4)
    expect(paletteFromRgba(clear, 4)).toEqual({ hex: [], lab: [], share: [] })
  })

  it('invalid k rejected', async () => {
    await expect(palette({ src: fx.blocksWebp, k: 5 as 8 }, TOOLS)).rejects.toMatchObject({
      code: 'validation',
    })
  })
})

describe('k-means++ and merging', () => {
  it('PRNG seed 42 reproducible', () => {
    const r1 = mulberry32(42)
    const r2 = mulberry32(42)
    const s1 = [r1(), r1(), r1()]
    expect([r2(), r2(), r2()]).toEqual(s1)
    expect(s1.every((v) => v >= 0 && v < 1)).toBe(true)
  })

  it('one color → one cluster', () => {
    const pts = new Float64Array(30).map((_, i) => [50, 10, -20][i % 3]!)
    const cs = kmeansLab(pts, 8)
    expect(cs).toHaveLength(1)
    expect(cs[0]!.count).toBe(10)
  })

  it('ΔE76 < 8 merged and < 1 % rejected', () => {
    const merged = mergeClusters([
      { lab: [50, 0, 0], count: 600 },
      { lab: [53, 2, 0], count: 300 }, // ΔE ≈ 3.6 → merged
      { lab: [80, 40, 40], count: 95 },
      { lab: [20, -40, 30], count: 5 }, // 0.5 % → rejected
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]!.count).toBe(900)
    expect(merged[0]!.lab[0]).toBeCloseTo(51, 5)
    expect(merged[1]!.count).toBe(95)
  })
})
