/**
 * canvas geometry (camera, snapping, resizing with rotation,
 * rotation, alignment, distribution, order), history, simulated AZERTY / QWERTY keymap.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  fitBox,
  screenToWorld,
  stepZoom,
  wheelAction,
  worldToScreen,
  zoomAt,
} from '../../../src/renderer/src/features/spaces/editor/geometry/camera'
import { SNAP_PX, snapBox } from '../../../src/renderer/src/features/spaces/editor/geometry/snap'
import {
  HANDLES,
  HANDLE_DIR,
  handlePoint,
  resize,
  rotateTo,
} from '../../../src/renderer/src/features/spaces/editor/geometry/resize'
import {
  align,
  distribute,
  reorder,
} from '../../../src/renderer/src/features/spaces/editor/geometry/align'
import {
  History,
  applySide,
  diffIds,
} from '../../../src/renderer/src/features/spaces/editor/store/history'
import {
  resolveShortcut,
  type KeyLike,
} from '../../../src/renderer/src/features/spaces/editor/keymap'
import { aabb, gridPlacement } from '../../../src/shared/spaces-geometry'
import type { SpaceNode } from '../../../src/shared/spaces-schema'

describe('camera', () => {
  it('zoomAt: the world point under the anchor is invariant (1e-9)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: MIN_ZOOM, max: MAX_ZOOM, noNaN: true }),
        fc.double({ min: MIN_ZOOM, max: MAX_ZOOM, noNaN: true }),
        fc.double({ min: 0, max: 1500, noNaN: true }),
        fc.double({ min: 0, max: 900, noNaN: true }),
        (x, y, z0, z1, ax, ay) => {
          const c = { x, y, zoom: z0 }
          const a = { x: ax, y: ay }
          const before = screenToWorld(c, a)
          const after = screenToWorld(zoomAt(c, a, z1), a)
          expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9 * Math.max(1, Math.abs(before.x)))
          expect(Math.abs(after.y - before.y)).toBeLessThan(1e-9 * Math.max(1, Math.abs(before.y)))
        },
      ),
    )
  })

  it('bounds, steps, world ↔ screen round trip, fitBox centre', () => {
    const c = { x: 0, y: 0, zoom: 1 }
    expect(zoomAt(c, { x: 0, y: 0 }, 100).zoom).toBe(MAX_ZOOM)
    expect(zoomAt(c, { x: 0, y: 0 }, 0).zoom).toBe(MIN_ZOOM)
    expect(stepZoom(1, 1)).toBe(1.25)
    expect(stepZoom(1, -1)).toBe(0.75)
    const p = { x: 123.4, y: -56.7 }
    const cam = { x: 40, y: -12, zoom: 1.7 }
    const back = screenToWorld(cam, worldToScreen(cam, p))
    expect(back.x).toBeCloseTo(p.x, 9)
    const f = fitBox({ w: 1000, h: 600 }, { x: 100, y: 100, width: 200, height: 100 }, 64, 1)
    expect(f.zoom).toBe(1)
    expect(worldToScreen(f, { x: 200, y: 150 })).toEqual({ x: 500, y: 300 })
  })

  it('wheel: ⌃ = pinch, ⌘ or setting = zoom, otherwise pan', () => {
    const e = { deltaX: 3, deltaY: 10, deltaMode: 0, ctrlKey: false, metaKey: false }
    expect(wheelAction(e, 'scroll', 800)).toEqual({ kind: 'pan', dx: -3, dy: -10 })
    expect(wheelAction({ ...e, ctrlKey: true }, 'scroll', 800).kind).toBe('zoom')
    expect(wheelAction({ ...e, metaKey: true }, 'scroll', 800).kind).toBe('zoom')
    expect(wheelAction(e, 'zoom', 800).kind).toBe('zoom')
    expect(wheelAction({ ...e, deltaMode: 1 }, 'scroll', 800)).toEqual({
      kind: 'pan',
      dx: -48,
      dy: -160,
    })
  })
})

describe('snapping', () => {
  it('threshold 6 / zoom; guides produced; nothing beyond', () => {
    const other = { x: 100, y: 100, width: 50, height: 50 }
    const zoom = 2
    const th = SNAP_PX / zoom
    const near = snapBox({ x: 100 + th - 0.1, y: 300, width: 10, height: 40 }, [other], th)
    expect(near.dx).toBeCloseTo(-(th - 0.1), 9)
    expect(near.guides.some((g) => g.axis === 'x' && g.at === 100)).toBe(true)
    const far = snapBox({ x: 100 + th + 0.1, y: 300, width: 10, height: 40 }, [other], th)
    expect(far.dx).toBe(0)
    // Center on center in Y.
    const c = snapBox({ x: 400, y: 104, width: 40, height: 40 }, [other], 6)
    expect(c.dy).toBe(1)
  })
})

describe('resizing with rotation', () => {
  const box = { x: 10, y: 20, width: 200, height: 120, rotation: 0 }
  for (const r of [0, 30, 90, 137]) {
    it(`opposite anchor fixed at 1e-6 for the 8 handles (r = ${r}°)`, () => {
      const b = { ...box, rotation: r }
      for (const h of HANDLES) {
        const [sx, sy] = HANDLE_DIR[h]
        const anchor = handlePoint(b, -sx, -sy)
        const p = handlePoint(b, sx * 1.6, sy * 1.4)
        for (const lockAspect of [false, true]) {
          const out = resize(b, h, p, { lockAspect })
          const after = handlePoint({ ...out, rotation: r }, -sx, -sy)
          expect(after.x).toBeCloseTo(anchor.x, 6)
          expect(after.y).toBeCloseTo(anchor.y, 6)
        }
      }
    })
  }

  it('minimum 24; locked ratio; from the center', () => {
    const out = resize(box, 'se', { x: -500, y: -500 }, { lockAspect: false })
    expect(out.width).toBe(24)
    expect(out.height).toBe(24)
    const lock = resize(box, 'se', { x: 10 + 400, y: 20 + 130 }, { lockAspect: true })
    expect(lock.width / lock.height).toBeCloseTo(200 / 120, 9)
    const c = resize(box, 'e', { x: 10 + 300, y: 80 }, { lockAspect: false, fromCenter: true })
    expect(c.x + c.width / 2).toBeCloseTo(110, 9)
    expect(c.width).toBeCloseTo(400, 9)
  })

  it('rotation: ⇧ = 15° steps, normalized ]-180, 180]', () => {
    const b = { x: 0, y: 0, width: 100, height: 100, rotation: 0 }
    const r = rotateTo(b, { x: 100, y: 50 }, { x: 50, y: 100 }, 0)
    expect(r).toBeCloseTo(90, 9)
    expect(rotateTo(b, { x: 100, y: 50 }, { x: 98, y: 63 }, 0, true) % 15).toBe(0)
    expect(rotateTo(b, { x: 100, y: 50 }, { x: 0, y: 49 }, 170)).toBeLessThanOrEqual(180)
  })

  it('AABB of a box rotated by 90°: dimensions swapped', () => {
    const a = aabb({ x: 0, y: 0, width: 200, height: 100, rotation: 90 })
    expect(a.width).toBeCloseTo(100, 9)
    expect(a.height).toBeCloseTo(200, 9)
    expect(a.x).toBeCloseTo(50, 9)
  })
})

describe('alignment, distribution, order', () => {
  const n = (uuid: string, x: number, y: number, w = 50, h = 50) => ({
    uuid,
    x,
    y,
    width: w,
    height: h,
    rotation: 0,
  })
  it('align left / center / bottom', () => {
    const nodes = [n('a', 0, 0), n('b', 100, 40, 80, 20), n('c', 30, 200)]
    expect(align(nodes, 'left')).toEqual({ b: { x: 0, y: 40 }, c: { x: 0, y: 200 } })
    const hc = align(nodes, 'hcenter')
    expect(hc.a!.x! + 25).toBeCloseTo(90, 9)
    const bottom = align(nodes, 'bottom')
    expect(bottom.a!.y! + 50).toBe(250)
  })
  it('distribution: equal spacing (≥ 3)', () => {
    const nodes = [n('a', 0, 0), n('b', 70, 0), n('c', 300, 0)]
    const p = distribute(nodes, 'h')
    expect(p.b!.x).toBeCloseTo(150, 9)
    expect(distribute(nodes.slice(0, 2), 'h')).toEqual({})
  })
  it('order: bring forward, send backward, front, back', () => {
    const order = ['a', 'b', 'c', 'd']
    const z = (r: Record<string, number>) =>
      Object.entries(r)
        .sort((x, y) => x[1] - y[1])
        .map((e) => e[0])
    expect(z(reorder(order, ['b'], 'forward'))).toEqual(['a', 'c', 'b', 'd'])
    expect(z(reorder(order, ['c'], 'backward'))).toEqual(['a', 'c', 'b', 'd'])
    expect(z(reorder(order, ['a', 'b'], 'front'))).toEqual(['c', 'd', 'a', 'b'])
    expect(z(reorder(order, ['d'], 'back'))).toEqual(['d', 'a', 'b', 'c'])
  })
  it('centered grid: cols = ceil(sqrt(N)), spacing 24', () => {
    const pos = gridPlacement(
      Array.from({ length: 5 }, () => ({ width: 100, height: 50 })),
      { x: 0, y: 0 },
      { center: true },
    )
    expect(pos).toHaveLength(5)
    expect(pos[1]!.x - pos[0]!.x).toBe(124)
    expect(pos[3]!.y - pos[0]!.y).toBe(74)
  })
})

describe('historique', () => {
  const note = (uuid: string, x: number): SpaceNode => ({
    uuid,
    type: 'note',
    x,
    y: 0,
    width: 200,
    height: 200,
    rotation: 0,
    z: 0,
    locked: false,
    createdAt: 0,
    updatedAt: 0,
    content: '',
    style: { color: 'yellow', fontSize: 14, align: 'left' },
  })
  it('undo / redo round trip; coalescing < 600 ms; cap', () => {
    const h = new History()
    let nodes: Record<string, SpaceNode> = { a: note('a', 0) }
    const step = (next: Record<string, SpaceNode>, at: number, key?: string) => {
      const ids = diffIds(nodes, next)
      const before = Object.fromEntries(ids.map((id) => [id, nodes[id] ?? null]))
      const after = Object.fromEntries(ids.map((id) => [id, next[id] ?? null]))
      h.push({ label: 'x', before, after, at, ...(key ? { key } : {}) })
      nodes = next
    }
    step({ ...nodes, a: note('a', 1) }, 0, 'k')
    step({ ...nodes, a: note('a', 2) }, 100, 'k')
    step({ ...nodes, b: note('b', 9) }, 2000)
    expect(h.past).toHaveLength(2)
    let e = h.undo()!
    nodes = applySide(nodes, e.before).nodes
    expect(nodes.b).toBeUndefined()
    e = h.undo()!
    nodes = applySide(nodes, e.before).nodes
    expect(nodes.a!.x).toBe(0)
    e = h.redo()!
    nodes = applySide(nodes, e.after).nodes
    expect(nodes.a!.x).toBe(2)
    for (let i = 0; i < 250; i++)
      h.push({ label: 'y', before: {}, after: {}, at: 10_000 + i * 1000 })
    expect(h.past.length).toBe(200)
  })
})

describe('simulated AZERTY / QWERTY keymap', () => {
  const qwerty = new Map([
    ['KeyA', 'a'],
    ['KeyQ', 'q'],
    ['KeyW', 'w'],
    ['KeyZ', 'z'],
    ['KeyV', 'v'],
    ['KeyH', 'h'],
    ['KeyD', 'd'],
    ['KeyS', 's'],
  ])
  const azerty = new Map([
    ['KeyQ', 'a'],
    ['KeyA', 'q'],
    ['KeyZ', 'w'],
    ['KeyW', 'z'],
    ['KeyV', 'v'],
    ['KeyH', 'h'],
    ['KeyD', 'd'],
    ['KeyS', 's'],
    ['Semicolon', 'm'],
  ])
  const ev = (code: string, key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
    code,
    key,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    ...mods,
  })
  it('⌥A = align left: printed key "A" (KeyQ in AZERTY, KeyA in QWERTY), insensitive to "å"', () => {
    expect(resolveShortcut(ev('KeyA', 'å', { altKey: true }), qwerty)).toBe('alignLeft')
    expect(resolveShortcut(ev('KeyQ', 'æ', { altKey: true }), azerty)).toBe('alignLeft')
    expect(resolveShortcut(ev('KeyA', 'q', { altKey: true }), azerty)).toBeNull()
  })
  it('⌥W in AZERTY = KeyZ; ⌘Z (undo) follows the printed letter', () => {
    expect(resolveShortcut(ev('KeyZ', 'Ω', { altKey: true }), azerty)).toBe('alignTop')
    expect(resolveShortcut(ev('KeyW', 'z', { metaKey: true }), azerty)).toBe('undo')
    expect(resolveShortcut(ev('KeyZ', 'z', { metaKey: true }), qwerty)).toBe('undo')
    expect(resolveShortcut(ev('KeyZ', 'z', { metaKey: true, shiftKey: true }), qwerty)).toBe('redo')
  })
  it('⇧1 / ⇧2 / ⌘0 by position (Digit1 prints "&" in AZERTY)', () => {
    expect(resolveShortcut(ev('Digit1', '1', { shiftKey: true }), azerty)).toBe('fitAll')
    expect(resolveShortcut(ev('Digit1', '!', { shiftKey: true }), qwerty)).toBe('fitAll')
    expect(resolveShortcut(ev('Digit2', '2', { shiftKey: true }), azerty)).toBe('fitSelection')
    expect(resolveShortcut(ev('Digit0', 'à', { metaKey: true }), azerty)).toBe('zoom100')
  })
  it('⌥⌘↑ / ⌥⌘↓ (and ⇧); aliases ⌘] / ⌘[; tool letters', () => {
    expect(resolveShortcut(ev('ArrowUp', 'ArrowUp', { metaKey: true, altKey: true }), azerty)).toBe(
      'bringForward',
    )
    expect(
      resolveShortcut(
        ev('ArrowDown', 'ArrowDown', { metaKey: true, altKey: true, shiftKey: true }),
        azerty,
      ),
    ).toBe('sendToBack')
    expect(resolveShortcut(ev('BracketRight', ']', { metaKey: true }), qwerty)).toBe('bringForward')
    expect(resolveShortcut(ev('KeyV', 'v'), azerty)).toBe('tool.select')
    expect(resolveShortcut(ev('KeyH', 'h'), qwerty)).toBe('tool.hand')
    expect(resolveShortcut(ev('KeyH', 'ˇ', { altKey: true, ctrlKey: true }), qwerty)).toBe(
      'distributeH',
    )
  })
  it('⌘+ / ⌘= / ⌘−', () => {
    expect(resolveShortcut(ev('Equal', '=', { metaKey: true }), qwerty)).toBe('zoomIn')
    expect(resolveShortcut(ev('Slash', '+', { metaKey: true, shiftKey: true }), azerty)).toBe(
      'zoomIn',
    )
    expect(resolveShortcut(ev('Digit6', '-', { metaKey: true }), azerty)).toBe('zoomOut')
  })
})
