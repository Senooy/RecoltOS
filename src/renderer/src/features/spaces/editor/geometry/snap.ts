/**
 * Magnétisme (SPACES §1.5.3) : bords et centres de la boîte déplacée attirés par ceux des autres
 * nœuds à moins de `threshold` (6 px écran = 6 / zoom en monde). Rend le décalage et les guides.
 */
import type { Rect } from '../../../../../../shared/spaces-geometry'

export const SNAP_PX = 6

export interface Guide {
  axis: 'x' | 'y'
  /** Coordonnée monde de la ligne. */
  at: number
  from: number
  to: number
}

const xs = (r: Rect) => [r.x, r.x + r.width / 2, r.x + r.width]
const ys = (r: Rect) => [r.y, r.y + r.height / 2, r.y + r.height]

function best(moving: number[], targets: number[][], threshold: number): number | null {
  let bestD: number | null = null
  for (const m of moving) {
    for (const ts of targets) {
      for (const t of ts) {
        const d = t - m
        if (Math.abs(d) <= threshold && (bestD === null || Math.abs(d) < Math.abs(bestD))) bestD = d
      }
    }
  }
  return bestD
}

export function snapBox(
  moving: Rect,
  others: readonly Rect[],
  threshold: number,
  axes: { x?: boolean; y?: boolean } = {},
): { dx: number; dy: number; guides: Guide[] } {
  const useX = axes.x !== false
  const useY = axes.y !== false
  const dx = useX ? (best(xs(moving), others.map(xs), threshold) ?? 0) : 0
  const dy = useY ? (best(ys(moving), others.map(ys), threshold) ?? 0) : 0
  const m: Rect = { ...moving, x: moving.x + dx, y: moving.y + dy }
  const guides: Guide[] = []
  const eps = 1e-6
  if (useX && dx !== 0) {
    for (const line of xs(m)) {
      const hits = others.filter((o) => xs(o).some((v) => Math.abs(v - line) < eps))
      if (hits.length === 0) continue
      const from = Math.min(m.y, ...hits.map((o) => o.y))
      const to = Math.max(m.y + m.height, ...hits.map((o) => o.y + o.height))
      guides.push({ axis: 'x', at: line, from, to })
    }
  }
  if (useY && dy !== 0) {
    for (const line of ys(m)) {
      const hits = others.filter((o) => ys(o).some((v) => Math.abs(v - line) < eps))
      if (hits.length === 0) continue
      const from = Math.min(m.x, ...hits.map((o) => o.x))
      const to = Math.max(m.x + m.width, ...hits.map((o) => o.x + o.width))
      guides.push({ axis: 'y', at: line, from, to })
    }
  }
  return { dx, dy, guides }
}
