/** WP-14 : masonry pure (DESIGN §4.4). */
import { describe, expect, it } from 'vitest'
import {
  columnGeometry,
  layoutMasonry,
  neighbor,
  visibleIndices,
} from '../../../src/renderer/src/features/grid/layoutMasonry'

const opts = (width: number, columns: number) => ({ width, columns, gap: 8, padX: 18 })

describe('layoutMasonry', () => {
  it('largeurs de colonnes de référence', () => {
    expect(columnGeometry(opts(1280, 4))).toEqual({ colW: 305, columns: 4 })
    expect(columnGeometry(opts(1280, 8))).toEqual({ colW: 148.5, columns: 8 })
    expect(columnGeometry(opts(1040, 8)).columns).toBe(6)
  })

  it('colonne la plus courte, à égalité la plus à gauche ; ratios bornés ; mesure prioritaire', () => {
    const l = layoutMasonry(
      [
        { id: 'a', ratio: 1 },
        { id: 'b', ratio: 5 },
        { id: 'c', ratio: 0.1 },
        { id: 'd', measured: 200 },
        { id: 'e', ratio: 1 },
      ],
      opts(1280, 4),
    )
    expect(l.placed.map((p) => p.col)).toEqual([0, 1, 2, 3, 2])
    expect(l.placed[1]!.h).toBe(Math.round(305 * 2.2))
    expect(l.placed[2]!.h).toBe(Math.round(305 * 0.25))
    expect(l.placed[3]!.h).toBe(200)
    expect(l.placed[4]!.y).toBe(Math.round(305 * 0.25) + 8)
    expect(l.placed[0]!.x).toBe(18)
    // Déterministe.
    expect(layoutMasonry([{ id: 'a', ratio: 1 }], opts(1280, 4))).toEqual(
      layoutMasonry([{ id: 'a', ratio: 1 }], opts(1280, 4)),
    )
  })

  it('posts : colonne choisie sur la hauteur estimée, position sur la hauteur mesurée (uqre2k)', () => {
    const l = layoutMasonry(
      [
        { id: 't1', measured: 217, placementRatio: 0.5 },
        { id: 't2', measured: 195, placementRatio: 0.5 },
        { id: 'v1', ratio: 2 / 3 },
        { id: 'v2', ratio: 2 / 3 },
        { id: 'man', ratio: 16 / 9 },
        { id: 'clown', ratio: 9 / 16 },
      ],
      opts(1280, 4),
    )
    expect(l.placed.map((p) => p.col)).toEqual([0, 1, 2, 3, 0, 1])
    expect(l.placed[4]!.y).toBe(217 + 8)
    expect(l.placed[5]!.y).toBe(195 + 8)
  })

  it('fenêtrage et voisin géométrique', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: String(i),
      ratio: 1 + (i % 3) * 0.3,
    }))
    const l = layoutMasonry(items, opts(1280, 4))
    const vis = visibleIndices(l, 0, 400)
    expect(vis.length).toBeGreaterThan(0)
    expect(vis.length).toBeLessThan(items.length)
    for (const i of vis) expect(l.placed[i]!.y).toBeLessThanOrEqual(400)
    expect(l.placed[neighbor(l, 0, 'right')]!.col).toBe(1)
    expect(neighbor(l, 0, 'left')).toBe(0)
  })
})
