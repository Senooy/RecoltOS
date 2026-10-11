/**
 * Tuilage de l'export PNG (SPACES §1.9), pur et testable sans Electron : échelle bornée
 * (≤ 8 192 px de côté, ≤ 40 Mpx), marge de 48 unités, tuiles de 1 280 × 800 px CSS dont les
 * caméras sont décalées de multiples entiers de la tuile, copie ligne à ligne dans le tampon final.
 */
import type { Rect } from '../../shared/spaces-geometry'

export const EXPORT_PAD = 48
export const MAX_SIDE_PX = 8192
export const MAX_PIXELS = 40e6

export interface TilePlan {
  i: number
  j: number
  camera: { x: number; y: number; zoom: number }
  /** Coin haut-gauche de la tuile dans l'image finale (px). */
  ox: number
  oy: number
}

export interface ExportPlan {
  /** Pixels de sortie par unité monde (≤ échelle demandée). */
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

/** Copie la partie utile d'une tuile BGRA (`tileW` px de large) dans l'image finale. */
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
