/**
 * Tiling for the PNG export, pure and testable without Electron: bounded scale
 * (≤ 8 192 px per side, ≤ 40 Mpx), margin of 48 units, tiles of 1 280 × 800 CSS px whose
 * cameras are offset by whole multiples of the tile, row-by-row copy into the final buffer.
 */
import type { Rect } from '../../shared/spaces-geometry'

export const EXPORT_PAD = 48
export const MAX_SIDE_PX = 8192
export const MAX_PIXELS = 40e6

export interface TilePlan {
  i: number
  j: number
  camera: { x: number; y: number; zoom: number }
  /** Top-left corner of the tile in the final image (px). */
  ox: number
  oy: number
}

export interface ExportPlan {
  /** Output pixels per world unit (≤ requested scale). */
  scale: number
  reduced: boolean
  width: number
  height: number
  tilePx: { w: number; h: number }
  tiles: TilePlan[]
}

export function planExport(
  box: Rect,
  requested: number,
  sf: number,
  tile: { w: number; h: number },
): ExportPlan {
  const bw = box.width + 2 * EXPORT_PAD
  const bh = box.height + 2 * EXPORT_PAD
  const s = Math.min(requested, MAX_SIDE_PX / Math.max(bw, bh), Math.sqrt(MAX_PIXELS / (bw * bh)))
  const z = s / sf
  const width = Math.ceil(bw * s)
  const height = Math.ceil(bh * s)
  const tw = tile.w * sf
  const th = tile.h * sf
  const tiles: TilePlan[] = []
  for (let j = 0; j * th < height; j++) {
    for (let i = 0; i * tw < width; i++) {
      tiles.push({
        i,
        j,
        camera: {
          x: -(box.x - EXPORT_PAD) * z - i * tile.w,
          y: -(box.y - EXPORT_PAD) * z - j * tile.h,
          zoom: z,
        },
        ox: i * tw,
        oy: j * th,
      })
    }
  }
  return { scale: s, reduced: s < requested - 1e-9, width, height, tilePx: { w: tw, h: th }, tiles }
}

/** Copies the useful part of a BGRA tile (`tileW` px wide) into the final image. */
export function placeTile(
  out: Buffer,
  width: number,
  height: number,
  bmp: Buffer,
  tileW: number,
  t: Pick<TilePlan, 'ox' | 'oy'>,
): void {
  const tileH = Math.floor(bmp.length / 4 / tileW)
  const cw = Math.min(tileW, width - t.ox)
  const ch = Math.min(tileH, height - t.oy)
  for (let r = 0; r < ch; r++) {
    bmp.copy(out, ((t.oy + r) * width + t.ox) * 4, r * tileW * 4, (r * tileW + cw) * 4)
  }
}
