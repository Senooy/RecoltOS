/**
 * Canvas viewport: camera applied IMPERATIVELY on `.space-world`
 * (no React state per image), dot background realigned via CSS variables, AABB culling with
 * hysteresis (view + 50 %, recomputed only when the camera leaves the last rectangle; a node
 * outside the rectangle is unmounted, which frees its image), ≤ 2 active videos, pointer gestures (pan, move with snapping, resize, rotation,
 * marquee, creation), wheel (⌃ = pinch, ⌘ or setting = zoom, otherwise scroll).
 * `will-change: transform` only during a gesture (crisp text after zoom).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  aabb,
  rectsIntersect,
  unionRect,
  type Rect,
  type Vec,
} from '../../../../../shared/spaces-geometry'
import type { Camera, SpaceNode } from '../../../../../shared/spaces-schema'
import { tr } from '../../../i18n'
import { usePrefs } from '../../../state/prefs'
import { createAt, duplicateInPlace } from './actions'
import { contains, inflate, screenToWorld, viewRect, wheelAction, zoomAt } from './geometry/camera'
import { resize, rotateTo, type Handle } from './geometry/resize'
import { SNAP_PX, snapBox } from './geometry/snap'
import { NodeView, useVideos } from './NodeView'
import { SelectionOverlay } from './overlay/SelectionOverlay'
import {
  commit,
  commitEditing,
  persistence,
  setCamera,
  setMarquee,
  setPreview,
  setSelection,
  useCamera,
  useSpace,
  type BoxPatch,
} from './store/spaceStore'

const MOVE_THRESHOLD = 3
const SETTLE_MS = 150
/** Active video players at most; other videos show their poster. */
const MAX_VIDEOS = 2
/** On-screen size (CSS px) from which a video that is not hovered is considered "zoomed". */
const VIDEO_ZOOMED_PX = 480

type Gesture =
  | { kind: 'pan'; start: Vec; cam0: Camera; moved: boolean }
  | {
      kind: 'move'
      start: Vec
      startScreen: Vec
      ids: string[]
      orig: Record<string, { x: number; y: number }>
      bbox0: Rect
      others: Rect[]
      moved: boolean
      alt: boolean
      clickedId: string
      wasSelected: boolean
    }
  | { kind: 'resize'; id: string; handle: Handle; orig: SpaceNode }
  | { kind: 'rotate'; id: string; start: Vec; orig: SpaceNode }
  | { kind: 'marquee'; start: Vec; base: string[] }
  | { kind: 'create'; startScreen: Vec }

export interface ViewportHandle {
  /** World point under a client point. */
  clientToWorld(x: number, y: number): Vec
}

/** Minimum UI per type. */
function minFor(n: SpaceNode): number {
  if (n.type === 'note') return 80
  if (n.type === 'item' && n.style.contentHeight === undefined && n.width > n.height * 2) return 24
  return 24
}

function lockAspectOf(n: SpaceNode): boolean {
  return n.type === 'item' || n.type === 'image' ? n.style.lockAspect : false
}

export function Viewport({
  spaceHeld,
  onDoubleClickNode,
  onDoubleClickEmpty,
  onContextMenuAt,
  handleRef,
  children,
}: {
  spaceHeld: boolean
  onDoubleClickNode: (id: string) => void
  onDoubleClickEmpty: (at: Vec) => void
  onContextMenuAt?: (at: Vec, nodeId: string | null) => void
  handleRef?: React.MutableRefObject<ViewportHandle | null>
  children?: React.ReactNode
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const worldRef = useRef<HTMLDivElement | null>(null)
  const bgRef = useRef<HTMLDivElement | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const [interacting, setInteracting] = useState(false)
  const [panning, setPanning] = useState(false)
  const nodes = useSpace((s) => s.nodes)
  const selection = useSpace((s) => s.selection)
  const tool = useSpace((s) => s.tool)
  const background = useSpace((s) => s.background)
  const hoverId = useSpace((s) => s.hoverId)
  const wheelMode = usePrefs((s) => s.prefs.spacesWheel)
  const wheelRef = useRef(wheelMode)
  wheelRef.current = wheelMode
  const [cull, setCull] = useState<Rect | null>(null)
  const cullRef = useRef<Rect | null>(null)

  const rect = () => rootRef.current?.getBoundingClientRect() ?? new DOMRect()
  const toLocal = (e: { clientX: number; clientY: number }): Vec => {
    const r = rect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const toWorld = (e: { clientX: number; clientY: number }): Vec =>
    screenToWorld(useCamera.getState().camera, toLocal(e))

  if (handleRef)
    handleRef.current = { clientToWorld: (x, y) => toWorld({ clientX: x, clientY: y }) }

  // View size.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const update = () => useCamera.setState({ view: { w: el.clientWidth, h: el.clientHeight } })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Camera → world transform, background, culling (without re-rendering the nodes).
  useLayoutEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let last: Camera | null = null
    const apply = (st: ReturnType<typeof useCamera.getState>) => {
      const c = st.camera
      const world = worldRef.current
      const bg = bgRef.current
      if (world) world.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.zoom})`
      if (bg) {
        let gs = 24 * c.zoom
        while (gs < 12) gs *= 2
        bg.style.setProperty('--gs', `${gs}px`)
        bg.style.setProperty('--gx', `${c.x % gs}px`)
        bg.style.setProperty('--gy', `${c.y % gs}px`)
        bg.style.setProperty('--dot', c.zoom >= 2 ? '1.25px' : '1px')
        bg.dataset.hidden = c.zoom < 0.25 ? '1' : '0'
      }
      const vr = viewRect(c, st.view)
      if (
        !cullRef.current ||
        !contains(cullRef.current, vr) ||
        cullRef.current.width > vr.width * 4
      ) {
        cullRef.current = inflate(vr, 0.5)
        setCull(cullRef.current)
      }
      if (last && (last.x !== c.x || last.y !== c.y || last.zoom !== c.zoom)) {
        world?.classList.add('is-moving')
        if (settleTimer) clearTimeout(settleTimer)
        settleTimer = setTimeout(() => {
          world?.classList.remove('is-moving')
          const cur = useCamera.getState().camera
          useCamera.setState({ settled: cur, moving: false })
          persistence.setViewport(cur)
        }, SETTLE_MS)
      }
      last = c
    }
    apply(useCamera.getState())
    const off = useCamera.subscribe(apply)
    return () => {
      off()
      if (settleTimer) clearTimeout(settleTimer)
    }
  }, [])

  // Wheel (non-passive).
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const a = wheelAction(e, wheelRef.current, el.clientHeight)
      const c = useCamera.getState().camera
      if (a.kind === 'zoom') setCamera(zoomAt(c, toLocal(e), c.zoom * a.factor), { moving: true })
      else setCamera({ ...c, x: c.x + a.dx, y: c.y + a.dy }, { moving: true })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visibleIds = useMemo(() => {
    if (!cull) return []
    const sel = new Set(selection)
    const out: SpaceNode[] = []
    for (const n of Object.values(nodes))
      if (sel.has(n.uuid) || rectsIntersect(aabb(n), cull)) out.push(n)
    out.sort((a, b) => a.z - b.z)
    return out.map((n) => n.uuid)
  }, [nodes, cull, selection])

  // Active videos: on screen AND hovered, selected or large on screen (zoomed); hover /
  // selection first, then largest area; ≤ MAX_VIDEOS. Others keep their poster.
  const settledZoom = useCamera((s) => s.settled.zoom)
  useEffect(() => {
    if (settledZoom < 0.2) {
      useVideos.setState({ ids: [] })
      return
    }
    const st = useSpace.getState()
    const sel = new Set(st.selection)
    const vids = visibleIds
      .map((id) => st.nodes[id]!)
      .filter((n) => {
        if (n.type === 'image') return n.style.kind === 'video'
        if (n.type === 'item' && n.itemUuid) {
          const c = st.items[n.itemUuid]
          return c?.kind === 'video' && c.mediaCount < 2 && Boolean(c.previewUrl)
        }
        return false
      })
    const vr = viewRect(useCamera.getState().settled, useCamera.getState().view)
    const onScreen = vids.filter(
      (n) =>
        rectsIntersect(aabb(n), vr) &&
        (n.uuid === hoverId ||
          sel.has(n.uuid) ||
          Math.max(n.width, n.height) * settledZoom >= VIDEO_ZOOMED_PX),
    )
    onScreen.sort((a, b) => {
      const pa = a.uuid === hoverId || sel.has(a.uuid) ? 1 : 0
      const pb = b.uuid === hoverId || sel.has(b.uuid) ? 1 : 0
      return pb - pa || b.width * b.height - a.width * a.height
    })
    const ids = onScreen.slice(0, MAX_VIDEOS).map((n) => n.uuid)
    const prev = useVideos.getState().ids
    if (ids.length !== prev.length || ids.some((id, i) => prev[i] !== id))
      useVideos.setState({ ids })
  }, [visibleIds, settledZoom, hoverId, selection])

  // --- Gestures ---------------------------------------------------------------------------

  const othersRects = (exclude: Set<string>): Rect[] => {
    const st = useSpace.getState()
    const vr = cullRef.current
    const out: Rect[] = []
    for (const n of Object.values(st.nodes)) {
      if (exclude.has(n.uuid)) continue
      const b = aabb(n)
      if (!vr || rectsIntersect(b, vr)) out.push(b)
    }
    return out
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 2) return
    const target = e.target as Element
    const st = useSpace.getState()
    const local = toLocal(e)
    const world = screenToWorld(useCamera.getState().camera, local)
    // Pan: middle click, Hand tool, Space held.
    if (e.button === 1 || st.tool === 'hand' || spaceHeld) {
      e.preventDefault()
      gesture.current = {
        kind: 'pan',
        start: local,
        cam0: useCamera.getState().camera,
        moved: false,
      }
      setPanning(true)
      rootRef.current?.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    const handleEl = target.closest('[data-handle],[data-rotate]')
    if (handleEl && st.selection.length === 1) {
      const n = st.nodes[st.selection[0]!]
      if (n && !n.locked) {
        e.preventDefault()
        gesture.current = handleEl.hasAttribute('data-rotate')
          ? { kind: 'rotate', id: n.uuid, start: world, orig: n }
          : {
              kind: 'resize',
              id: n.uuid,
              handle: handleEl.getAttribute('data-handle') as Handle,
              orig: n,
            }
        setInteracting(true)
        rootRef.current?.setPointerCapture(e.pointerId)
        return
      }
    }
    const nodeEl = target.closest('[data-node]')
    const id = nodeEl?.getAttribute('data-node') ?? null
    if (id && st.editingId === id) return // text editing: the browser handles it
    if (st.editingId) {
      commitEditing()
      useSpace.setState({ editingId: null })
    }
    if (st.tool !== 'select') {
      gesture.current = { kind: 'create', startScreen: local }
      rootRef.current?.setPointerCapture(e.pointerId)
      return
    }
    rootRef.current?.focus({ preventScroll: true })
    if (id) {
      const wasSelected = st.selection.includes(id)
      let sel = st.selection
      if (e.shiftKey) {
        sel = wasSelected ? sel.filter((x) => x !== id) : [...sel, id]
        setSelection(sel)
        if (wasSelected) return
      } else if (!wasSelected) {
        sel = [id]
        setSelection(sel)
      }
      const movable = sel.filter((x) => st.nodes[x] && !st.nodes[x].locked)
      if (movable.length === 0) return
      const orig: Record<string, { x: number; y: number }> = {}
      for (const x of movable) orig[x] = { x: st.nodes[x]!.x, y: st.nodes[x]!.y }
      gesture.current = {
        kind: 'move',
        start: world,
        startScreen: local,
        ids: movable,
        orig,
        bbox0: unionRect(movable.map((x) => aabb(st.nodes[x]!)))!,
        others: othersRects(new Set(movable)),
        moved: false,
        alt: e.altKey,
        clickedId: id,
        wasSelected,
      }
      rootRef.current?.setPointerCapture(e.pointerId)
      return
    }
    // Empty: marquee.
    const base = e.shiftKey ? st.selection : []
    if (!e.shiftKey) setSelection([])
    gesture.current = { kind: 'marquee', start: world, base }
    rootRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g) {
      const id = (e.target as Element).closest('[data-node]')?.getAttribute('data-node') ?? null
      if (useSpace.getState().hoverId !== id) useSpace.setState({ hoverId: id })
      return
    }
    const local = toLocal(e)
    const cam = useCamera.getState().camera
    const p = screenToWorld(cam, local)
    switch (g.kind) {
      case 'pan': {
        g.moved = true
        setCamera(
          { ...g.cam0, x: g.cam0.x + local.x - g.start.x, y: g.cam0.y + local.y - g.start.y },
          { moving: true },
        )
        return
      }
      case 'move': {
        if (!g.moved) {
          if (Math.hypot(local.x - g.startScreen.x, local.y - g.startScreen.y) < MOVE_THRESHOLD)
            return
          g.moved = true
          setInteracting(true)
          if (g.alt) {
            const copies = duplicateInPlace(g.ids)
            if (copies.length > 0) {
              const st = useSpace.getState()
              g.ids = copies
              g.orig = {}
              for (const x of copies) g.orig[x] = { x: st.nodes[x]!.x, y: st.nodes[x]!.y }
            }
          }
        }
        let dx = p.x - g.start.x
        let dy = p.y - g.start.y
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0
          else dx = 0
        }
        let guides: ReturnType<typeof snapBox>['guides'] = []
        if (!e.metaKey) {
          const s = snapBox(
            { ...g.bbox0, x: g.bbox0.x + dx, y: g.bbox0.y + dy },
            g.others,
            SNAP_PX / cam.zoom,
            e.shiftKey ? { x: dx !== 0, y: dy !== 0 } : {},
          )
          dx += s.dx
          dy += s.dy
          guides = s.guides
        }
        const pv: Record<string, BoxPatch> = {}
        for (const id of g.ids) pv[id] = { x: g.orig[id]!.x + dx, y: g.orig[id]!.y + dy }
        setPreview(pv, guides)
        return
      }
      case 'resize': {
        const lock = lockAspectOf(g.orig) !== e.shiftKey
        const r = resize(g.orig, g.handle, p, {
          lockAspect: lock,
          fromCenter: e.altKey,
          min: minFor(g.orig),
        })
        setPreview({ [g.id]: r })
        return
      }
      case 'rotate': {
        setPreview({
          [g.id]: { rotation: rotateTo(g.orig, g.start, p, g.orig.rotation, e.shiftKey) },
        })
        return
      }
      case 'marquee': {
        const r: Rect = {
          x: Math.min(g.start.x, p.x),
          y: Math.min(g.start.y, p.y),
          width: Math.abs(p.x - g.start.x),
          height: Math.abs(p.y - g.start.y),
        }
        setMarquee(r)
        const hit = Object.values(useSpace.getState().nodes)
          .filter((n) => rectsIntersect(aabb(n), r))
          .map((n) => n.uuid)
        setSelection([...g.base, ...hit])
        return
      }
      case 'create':
        return
    }
  }

  const endGesture = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    gesture.current = null
    if (rootRef.current?.hasPointerCapture(e.pointerId))
      rootRef.current.releasePointerCapture(e.pointerId)
    if (!g) return
    const pv = useSpace.getState().preview
    switch (g.kind) {
      case 'pan':
        setPanning(false)
        return
      case 'move':
        if (g.moved && pv) {
          commit('Déplacer', (d) => {
            for (const [id, v] of Object.entries(pv)) Object.assign(d[id]!, v)
          })
        } else if (!g.moved && g.wasSelected && !e.shiftKey) {
          setSelection([g.clickedId])
        }
        break
      case 'resize':
        if (pv?.[g.id]) {
          const v = pv[g.id]!
          commit('Redimensionner', (d) => {
            const n = d[g.id]
            if (!n) return
            Object.assign(n, v)
            if (n.type === 'text' && (g.handle === 'e' || g.handle === 'w'))
              n.style.autoWidth = false
          })
        }
        break
      case 'rotate':
        if (pv?.[g.id]) {
          const v = pv[g.id]!
          commit('Pivoter', (d) => {
            if (d[g.id]) Object.assign(d[g.id]!, v)
          })
        }
        break
      case 'marquee':
        setMarquee(null)
        break
      case 'create': {
        const tool = useSpace.getState().tool
        createAt(tool, screenToWorld(useCamera.getState().camera, g.startScreen))
        break
      }
    }
    setPreview(null, [])
    setInteracting(false)
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const id = (e.target as Element).closest('[data-node]')?.getAttribute('data-node') ?? null
    if (id) onDoubleClickNode(id)
    else onDoubleClickEmpty(toWorld(e))
  }

  return (
    <div
      ref={rootRef}
      className="space-viewport h-full w-full"
      data-testid="space-viewport"
      data-tool={tool}
      data-pan={spaceHeld ? '1' : undefined}
      data-panning={panning ? '1' : undefined}
      tabIndex={-1}
      aria-label={tr.uiKit.canvas}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onPointerLeave={() => {
        if (!gesture.current && useSpace.getState().hoverId) useSpace.setState({ hoverId: null })
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        const id = (e.target as Element).closest('[data-node]')?.getAttribute('data-node') ?? null
        if (id && !useSpace.getState().selection.includes(id)) setSelection([id])
        onContextMenuAt?.(toWorld(e), id)
      }}
    >
      <div ref={bgRef} className="space-bg" data-bg={background} />
      <div ref={worldRef} className="space-world" data-testid="space-world">
        {visibleIds.map((id) => (
          <NodeView key={id} id={id} />
        ))}
      </div>
      <SelectionOverlay interacting={interacting} />
      {children}
    </div>
  )
}
