/**
 * Géométrie Spaces partagée main ↔ renderer (SPACES §1.2.3, §1.6) : enveloppes AABB de boîtes
 * orientées, tailles par défaut des nœuds, placement en grille. Pur, sans dépendance.
 */
import { MIN_NODE_SIZE } from './spaces-schema'

export interface Vec {
  x: number
  y: number
}
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface OrientedBox extends Rect {
  /** Degrés, autour du centre. */
  rotation: number
}

/** Enveloppe alignée sur les axes d'une boîte tournée autour de son centre. */
export function aabb(b: OrientedBox): Rect {
  const r = ((b.rotation ?? 0) * Math.PI) / 180
  if (r === 0) return { x: b.x, y: b.y, width: b.width, height: b.height }
  const c = Math.abs(Math.cos(r))
  const s = Math.abs(Math.sin(r))
  const w = b.width * c + b.height * s
  const h = b.width * s + b.height * c
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h }
}

/** Union d'enveloppes ; `null` si la liste est vide. */
export function unionRect(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Côté long d'un élément média posé sur la toile. */
export const ITEM_LONG_SIDE = 320
/** Largeur d'une carte de post (tweet) ou de page. */
export const POST_NODE_WIDTH = 340
/** Hauteur par défaut d'une carte de post, avant mesure. */
export const POST_NODE_HEIGHT = 420
/** Image déposée : côté long au plus 360. */
export const ASSET_LONG_SIDE = 360
export const NOTE_SIZE = 200
export const SHAPE_SIZE = { width: 160, height: 120 } as const
export const GRID_GAP_WORLD = 24

export interface ItemSizeInput {
  kind: 'image' | 'video' | 'tweet' | 'url'
  width: number | null
  height: number | null
}

const clampSize = (n: number) => Math.max(MIN_NODE_SIZE, Math.round(n))

/** Taille d'un nœud média dont le côté long vaut `long` (ratio du média). */
export function fitLongSide(w: number | null, h: number | null, long: number) {
  if (!w || !h || w <= 0 || h <= 0) return { width: long, height: long }
  const k = long / Math.max(w, h)
  return { width: clampSize(w * k), height: clampSize(h * k) }
}

/** Taille initiale d'un nœud `item` (SPACES §1.2.3). */
export function defaultItemSize(i: ItemSizeInput): { width: number; height: number } {
  if (i.kind === 'tweet') return { width: POST_NODE_WIDTH, height: POST_NODE_HEIGHT }
  if (i.kind === 'url')
    return { width: POST_NODE_WIDTH, height: Math.round(POST_NODE_WIDTH * 0.6) + 56 }
  return fitLongSide(i.width, i.height, ITEM_LONG_SIDE)
}

/**
 * Range des boîtes en grille (`cols = ceil(sqrt(N))`, espace 24). `origin` = coin haut-gauche ;
 * `center: true` centre la grille sur `origin`. Renvoie la position du coin haut-gauche de chacune.
 */
export function gridPlacement(
  sizes: readonly { width: number; height: number }[],
  origin: Vec,
  opts: { gap?: number; center?: boolean } = {},
): Vec[] {
  const n = sizes.length
  if (n === 0) return []
  const gap = opts.gap ?? GRID_GAP_WORLD
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const colW = new Array<number>(cols).fill(0)
  const rowH = new Array<number>(rows).fill(0)
  sizes.forEach((s, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    colW[c] = Math.max(colW[c]!, s.width)
    rowH[r] = Math.max(rowH[r]!, s.height)
  })
  const totalW = colW.reduce((a, b) => a + b, 0) + gap * (cols - 1)
  const totalH = rowH.reduce((a, b) => a + b, 0) + gap * (rows - 1)
  const x0 = opts.center ? origin.x - totalW / 2 : origin.x
  const y0 = opts.center ? origin.y - totalH / 2 : origin.y
  const colX: number[] = []
  let acc = x0
  for (let c = 0; c < cols; c++) {
    colX.push(acc)
    acc += colW[c]! + gap
  }
  const rowY: number[] = []
  acc = y0
  for (let r = 0; r < rows; r++) {
    rowY.push(acc)
    acc += rowH[r]! + gap
  }
  return sizes.map((_, i) => ({ x: colX[i % cols]!, y: rowY[Math.floor(i / cols)]! }))
}
