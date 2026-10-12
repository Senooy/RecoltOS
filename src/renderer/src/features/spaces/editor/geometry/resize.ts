/**
 * Resize and rotation: computed in the node's local frame, with a fixed
 * opposite anchor (tested to 1e-6 for the 8 handles and r ∈ {0, 30, 90, 137°}). ⇧ inverts the
 * aspect-ratio lock; ⌥ resizes from the center. Rotation: ⇧ = 15° steps.
 */
import type { OrientedBox, Vec } from '../../../../../../shared/spaces-geometry'
import { MIN_NODE_SIZE, normalizeRotation } from '../../../../../../shared/spaces-schema'

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Handle direction from the center. */
export const HANDLE_DIR: Readonly<Record<Handle, readonly [number, number]>> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
}

const rot = (a: number, v: Vec): Vec => ({
  x: v.x * Math.cos(a) - v.y * Math.sin(a),
  y: v.x * Math.sin(a) + v.y * Math.cos(a),
})
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })

export const centerOf = (b: OrientedBox): Vec => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })

/** World point of a handle (or corner) of the oriented box. */
export function handlePoint(b: OrientedBox, sx: number, sy: number): Vec {
  const r = (b.rotation * Math.PI) / 180
  return add(centerOf(b), rot(r, { x: (sx * b.width) / 2, y: (sy * b.height) / 2 }))
}

export interface ResizeOptions {
  lockAspect: boolean
  /** ⌥: from the center. */
  fromCenter?: boolean
  /** Minimum of the type (≥ MIN_NODE_SIZE). */
  min?: number
}

export function resize(
  b: OrientedBox,
  handle: Handle,
  p: Vec,
  o: ResizeOptions,
): { x: number; y: number; width: number; height: number } {
  const [sx, sy] = HANDLE_DIR[handle]
  const r = (b.rotation * Math.PI) / 180
  const c = centerOf(b)
  const w = b.width
  const h = b.height
  const min = Math.max(MIN_NODE_SIZE, o.min ?? MIN_NODE_SIZE)
  if (o.fromCenter) {
    const d = rot(-r, sub(p, c))
    let nw = sx !== 0 ? Math.max(min, 2 * sx * d.x) : w
    let nh = sy !== 0 ? Math.max(min, 2 * sy * d.y) : h
    if (o.lockAspect && sx !== 0 && sy !== 0) {
      const k = Math.max(nw / w, nh / h)
      nw = w * k
      nh = h * k
    }
    return { x: c.x - nw / 2, y: c.y - nh / 2, width: nw, height: nh }
  }
  const A = add(c, rot(r, { x: (-sx * w) / 2, y: (-sy * h) / 2 }))
  const d = rot(-r, sub(p, A))
  let nw = sx !== 0 ? Math.max(min, sx * d.x) : w
  let nh = sy !== 0 ? Math.max(min, sy * d.y) : h
  if (o.lockAspect && sx !== 0 && sy !== 0) {
    const k = Math.max(nw / w, nh / h)
    nw = w * k
    nh = h * k
  }
  // Side handle: the free axis stays centered on the anchor (sx or sy = 0).
  const c2 = add(A, rot(r, { x: (sx * nw) / 2, y: (sy * nh) / 2 }))
  return { x: c2.x - nw / 2, y: c2.y - nh / 2, width: nw, height: nh }
}

/** Angle (degrees) of a rotation started at `start` with initial rotation `r0`. */
export function rotateTo(b: OrientedBox, start: Vec, p: Vec, r0: number, snap15 = false): number {
  const c = centerOf(b)
  const a0 = Math.atan2(start.y - c.y, start.x - c.x)
  const a1 = Math.atan2(p.y - c.y, p.x - c.x)
  let deg = r0 + ((a1 - a0) * 180) / Math.PI
  if (snap15) deg = Math.round(deg / 15) * 15
  return normalizeRotation(deg)
}
