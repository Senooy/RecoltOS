/**
 * tuilage de l'export PNG sans Electron (échelle bornée, caméras à multiples entiers de la
 * tuile, assemblage sans couture ni débordement).
 */
import { describe, expect, it } from 'vitest'
import { EXPORT_PAD, placeTile, planExport } from '../../../src/main/spaces/tiles'

describe('tuilage de l’export', () => {
  it('dimensions, tuiles, caméras décalées de tuiles entières', () => {
    const p = planExport({ x: 100, y: 50, width: 1600, height: 1100 }, 1, 1, { w: 1280, h: 800 })
    expect(p).toMatchObject({ scale: 1, reduced: false, width: 1696, height: 1196 })
    expect(p.tiles).toHaveLength(4)
    const [a, b] = p.tiles
    expect(a!.camera).toEqual({ x: -(100 - EXPORT_PAD), y: -(50 - EXPORT_PAD), zoom: 1 })
    expect(b!.camera.x - a!.camera.x).toBe(-1280)
    expect(b!.ox).toBe(1280)
  })

  it('Retina (capture ×2) : zoom = échelle / 2, tuiles de 2 560 px', () => {
    const p = planExport({ x: 0, y: 0, width: 4000, height: 3000 }, 2, 2, { w: 1280, h: 800 })
    expect(p.tilePx).toEqual({ w: 2560, h: 1600 })
    expect(p.tiles[0]!.camera.zoom).toBeCloseTo(p.scale / 2, 12)
  })

  it('échelle réduite au-delà de 8 192 px ou 40 Mpx', () => {
    const big = planExport({ x: 0, y: 0, width: 4000, height: 3000 }, 3, 1, { w: 1280, h: 800 })
    expect(big.reduced).toBe(true)
    expect(big.width * big.height).toBeLessThanOrEqual(40e6 + big.width + big.height)
    const wide = planExport({ x: 0, y: 0, width: 20000, height: 100 }, 1, 1, { w: 1280, h: 800 })
    expect(Math.max(wide.width, wide.height)).toBeLessThanOrEqual(8192)
  })

  it('placeTile : copie des lignes utiles, bord droit / bas tronqués', () => {
    const W = 5
    const H = 3
    const out = Buffer.alloc(W * H * 4)
    const tile = Buffer.alloc(4 * 4 * 4, 7) // tuile 4 × 4 remplie de 7
    placeTile(out, W, H, tile, 4, { ox: 4, oy: 1 })
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = out[(y * W + x) * 4]
        expect(v).toBe(x === 4 && y >= 1 ? 7 : 0)
      }
    }
  })
})
