/**
 * Deterministic in-house masonry: shortest column (on a tie, the leftmost),
 * heights by ratio bounded to [0.25 ; 2.2], measured heights for text posts, safeguard
 * `minColW` (140) that reduces the effective number of columns. Pure function.
 */
export interface MasonryItem {
  id: string
  /** Height / width. */
  ratio?: number
  /** Fixed height added (card footer). */
  fixedExtra?: number
  /** Measured height (text posts): takes priority. */
  measured?: number
  /**
   * ESTIMATED height used only to choose the column (text posts: `colW × 0.5`), the vertical
   * position following the real height: posts are placed before being measured.
   */
  placementRatio?: number
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

/** Column width and effective number of columns. */
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
  /** Heights used to choose the column (estimated for posts). */
  const choice = new Array<number>(columns).fill(0)
  const placed: Placed[] = []
  for (const it of items) {
    let col = 0
    for (let c = 1; c < columns; c++) if (choice[c]! < choice[col]!) col = c
    const h =
      it.measured !== undefined && it.measured > 0
        ? Math.round(it.measured)
        : Math.round(colW * clampRatio(it.ratio ?? 1)) + (it.fixedExtra ?? 0)
    const y = heights[col]!
    placed.push({ id: it.id, x: o.padX + col * (colW + o.gap), y, w: colW, h, col })
    heights[col] = y + h + o.gap
    const est = it.placementRatio !== undefined ? Math.round(colW * it.placementRatio) : h
    choice[col] = choice[col]! + est + o.gap
  }
  const height = Math.max(0, ...heights.map((v) => v - o.gap))
  return { placed, height: placed.length > 0 ? height : 0, colW, columns }
}

/** Indices of the visible items in `[top, bottom]` (binary search per column). */
export function visibleIndices(layout: MasonryLayout, top: number, bottom: number): number[] {
  const byCol: number[][] = Array.from({ length: layout.columns }, () => [])
  layout.placed.forEach((p, i) => byCol[p.col]!.push(i))
  const out: number[] = []
  for (const list of byCol) {
    // First item whose bottom exceeds `top`.
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

/** Closest geometric neighbour in a direction (keyboard navigation). */
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
