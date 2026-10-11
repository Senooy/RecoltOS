/**
 * Masonry maison déterministe (DESIGN §4.4) : colonne la plus courte (à égalité, la plus à gauche),
 * hauteurs par ratio bornées à [0,25 ; 2,2], hauteurs mesurées pour les posts texte, garde-fou
 * `minColW` (140) qui réduit le nombre de colonnes effectives. Fonction pure.
 */
export interface MasonryItem {
  id: string
  /** Hauteur / largeur. */
  ratio?: number
  /** Hauteur fixe ajoutée (pied de carte). */
  fixedExtra?: number
  /** Hauteur mesurée (posts texte) : prioritaire. */
  measured?: number
}

export interface Placed {
  id: string
  x: number
  y: number
  w: number
  h: number
  col: number
}

export interface MasonryOptions {
  width: number
  columns: number
  gap: number
  padX: number
  minColW?: number
}

export interface MasonryLayout {
  placed: Placed[]
  height: number
  colW: number
  columns: number
}

export const MIN_COL_W = 140
export const RATIO_MIN = 0.25
export const RATIO_MAX = 2.2

export const clampRatio = (r: number): number =>
  Number.isFinite(r) && r > 0 ? Math.min(RATIO_MAX, Math.max(RATIO_MIN, r)) : 1

/** Largeur de colonne et nombre de colonnes effectives. */
export function columnGeometry(o: MasonryOptions): { colW: number; columns: number } {
  const minColW = o.minColW ?? MIN_COL_W
  const inner = Math.max(0, o.width - 2 * o.padX)
  let n = Math.max(1, Math.round(o.columns))
  let colW = (inner - (n - 1) * o.gap) / n
  if (colW < minColW) {
    n = Math.max(1, Math.floor((inner + o.gap) / (minColW + o.gap)))
    colW = (inner - (n - 1) * o.gap) / n
  }
  return { colW, columns: n }
}

export function layoutMasonry(items: readonly MasonryItem[], o: MasonryOptions): MasonryLayout {
  const { colW, columns } = columnGeometry(o)
  const heights = new Array<number>(columns).fill(0)
  const placed: Placed[] = []
  for (const it of items) {
    let col = 0
    for (let c = 1; c < columns; c++) if (heights[c]! < heights[col]!) col = c
    const h =
      it.measured !== undefined && it.measured > 0
        ? Math.round(it.measured)
        : Math.round(colW * clampRatio(it.ratio ?? 1)) + (it.fixedExtra ?? 0)
    const y = heights[col]!
    placed.push({ id: it.id, x: o.padX + col * (colW + o.gap), y, w: colW, h, col })
    heights[col] = y + h + o.gap
  }
  const height = Math.max(0, ...heights.map((v) => v - o.gap))
  return { placed, height: placed.length > 0 ? height : 0, colW, columns }
}

/** Index des éléments visibles dans `[top, bottom]` (recherche binaire par colonne, DESIGN §4.4). */
export function visibleIndices(layout: MasonryLayout, top: number, bottom: number): number[] {
  const byCol: number[][] = Array.from({ length: layout.columns }, () => [])
  layout.placed.forEach((p, i) => byCol[p.col]!.push(i))
  const out: number[] = []
  for (const list of byCol) {
    // Premier élément dont le bas dépasse `top`.
    let lo = 0
    let hi = list.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const p = layout.placed[list[mid]!]!
      if (p.y + p.h < top) lo = mid + 1
      else hi = mid
    }
    for (let k = lo; k < list.length; k++) {
      const p = layout.placed[list[k]!]!
      if (p.y > bottom) break
      out.push(list[k]!)
    }
  }
  return out.sort((a, b) => a - b)
}

/** Voisin géométrique le plus proche dans une direction (navigation clavier). */
export function neighbor(
  layout: MasonryLayout,
  index: number,
  dir: 'left' | 'right' | 'up' | 'down',
): number {
  const from = layout.placed[index]
  if (!from) return index
  const cx = from.x + from.w / 2
  const cy = from.y + from.h / 2
  let best = index
  let bestScore = Infinity
  layout.placed.forEach((p, i) => {
    if (i === index) return
    const px = p.x + p.w / 2
    const py = p.y + p.h / 2
    const dx = px - cx
    const dy = py - cy
    const ok =
      (dir === 'left' && dx < -1) ||
      (dir === 'right' && dx > 1) ||
      (dir === 'up' && dy < -1) ||
      (dir === 'down' && dy > 1)
    if (!ok) return
    const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy)
    const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    const score = primary + secondary * 2
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  })
  return best
}
