/**
 * Tiling of the PNG export without Electron (bounded scale, cameras at whole multiples of the
 * tile, seamless assembly with no overflow).
 */
import { describe, expect, it } from 'vitest'
import { EXPORT_PAD, placeTile, planExport } from '../../../src/main/spaces/tiles'

describe('export tiling', () => {
  it('dimensions, tiles, cameras offset by whole tiles', () => {
    const p = planExport({ x: 100, y: 50, width: 1600, height: 1100 }, 1, 1, { w: 1280, h: 800 })
    expect(p).toMatchObject({ scale: 1, reduced: false, width: 1696, height: 1196 })
    expect(p.tiles).toHaveLength(4)
    const [a, b] = p.tiles
    expect(a!.camera).toEqual({ x: -(100 - EXPORT_PAD), y: -(50 - EXPORT_PAD), zoom: 1 })
    expect(b!.camera.x - a!.camera.x).toBe(-1280)
    expect(b!.ox).toBe(1280)
  })

  it('Retina (×2 capture): zoom = scale / 2, 2,560 px tiles', () => {
    const p = planExport({ x: 0, y: 0, width: 4000, height: 3000 }, 2, 2, { w: 1280, h: 800 })
    expect(p.tilePx).toEqual({ w: 2560, h: 1600 })
    expect(p.tiles[0]!.camera.zoom).toBeCloseTo(p.scale / 2, 12)
  })

  it('scale reduced beyond 8,192 px or 40 Mpx', () => {
    const big = planExport({ x: 0, y: 0, width: 4000, height: 3000 }, 3, 1, { w: 1280, h: 800 })
    expect(big.reduced).toBe(true)
    expect(big.width * big.height).toBeLessThanOrEqual(40e6 + big.width + big.height)
    const wide = planExport({ x: 0, y: 0, width: 20000, height: 100 }, 1, 1, { w: 1280, h: 800 })
    expect(Math.max(wide.width, wide.height)).toBeLessThanOrEqual(8192)
  })

  it('placeTile: copies the useful rows, right / bottom edges truncated', () => {
    const W = 5
    const H = 3
    const out = Buffer.alloc(W * H * 4)
    const tile = Buffer.alloc(4 * 4 * 4, 7) // 4 × 4 tile filled with 7
    placeTile(out, W, H, tile, 4, { ox: 4, oy: 1 })
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = out[(y * W + x) * 4]
        expect(v).toBe(x === 4 && y >= 1 ? 7 : 0)
      }
    }
  })
})
