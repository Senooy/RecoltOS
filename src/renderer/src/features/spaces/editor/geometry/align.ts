/**
 * Alignment, distribution and order. Reference = bounding box of the selection; the
 * distribution (≥ 3 nodes) equalizes the gaps between bounding boxes sorted by center. Rotated nodes
 * are aligned by their bounding box (AABB). `reorder` returns new `z` values 0..n-1.
 */
import { aabb, unionRect, type OrientedBox } from '../../../../../../shared/spaces-geometry'

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
export type Patch = Record<string, { x?: number; y?: number }>

type N = OrientedBox & { uuid: string }

export function align(nodes: readonly N[], kind: AlignKind): Patch {
  const ref = unionRect(nodes.map(aabb))
  if (!ref || nodes.length < 2) return {}
  const out: Patch = {}
  for (const n of nodes) {
    const b = aabb(n)
    let dx = 0
    let dy = 0
    switch (kind) {
      case 'left':
        dx = ref.x - b.x
        break
      case 'right':
        dx = ref.x + ref.width - (b.x + b.width)
        break
      case 'hcenter':
        dx = ref.x + ref.width / 2 - (b.x + b.width / 2)
        break
      case 'top':
        dy = ref.y - b.y
        break
      case 'bottom':
        dy = ref.y + ref.height - (b.y + b.height)
        break
      case 'vcenter':
        dy = ref.y + ref.height / 2 - (b.y + b.height / 2)
        break
    }
    if (dx !== 0 || dy !== 0) out[n.uuid] = { x: n.x + dx, y: n.y + dy }
  }
  return out
}

export function distribute(nodes: readonly N[], axis: 'h' | 'v'): Patch {
  if (nodes.length < 3) return {}
  const items = nodes.map((n) => ({ n, b: aabb(n) }))
  const pos = (b: ReturnType<typeof aabb>) => (axis === 'h' ? b.x : b.y)
  const size = (b: ReturnType<typeof aabb>) => (axis === 'h' ? b.width : b.height)
  items.sort((a, b) => pos(a.b) + size(a.b) / 2 - (pos(b.b) + size(b.b) / 2))
  const first = items[0]!.b
  const last = items[items.length - 1]!.b
  const span = pos(last) + size(last) - pos(first)
  const total = items.reduce((s, i) => s + size(i.b), 0)
  const gap = (span - total) / (items.length - 1)
  const out: Patch = {}
  let cursor = pos(first)
  for (const { n, b } of items) {
    const d = cursor - pos(b)
    if (Math.abs(d) > 1e-9) out[n.uuid] = axis === 'h' ? { x: n.x + d } : { y: n.y + d }
    cursor += size(b) + gap
  }
  return out
}

/**
 * New order: `order` = uuids sorted by ascending `z`; `ids` = selection.
 * `forward` / `backward`: one step; `front` / `back`: to the top / bottom.
 */
export function reorder(
  order: readonly string[],
  ids: readonly string[],
  op: 'forward' | 'backward' | 'front' | 'back',
): Record<string, number> {
  const sel = new Set(ids)
  let list = [...order]
  if (op === 'front') list = [...list.filter((u) => !sel.has(u)), ...list.filter((u) => sel.has(u))]
  else if (op === 'back')
    list = [...list.filter((u) => sel.has(u)), ...list.filter((u) => !sel.has(u))]
  else if (op === 'forward') {
    for (let i = list.length - 2; i >= 0; i--) {
      if (sel.has(list[i]!) && !sel.has(list[i + 1]!)) {
        ;[list[i], list[i + 1]] = [list[i + 1]!, list[i]!]
      }
    }
  } else {
    for (let i = 1; i < list.length; i++) {
      if (sel.has(list[i]!) && !sel.has(list[i - 1]!)) {
        ;[list[i], list[i - 1]] = [list[i - 1]!, list[i]!]
      }
    }
  }
  const out: Record<string, number> = {}
  list.forEach((u, i) => (out[u] = i))
  return out
}
