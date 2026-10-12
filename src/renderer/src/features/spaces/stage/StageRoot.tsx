/**
 * « stage » window: `offscreen.html?render=space-stage`, without preload, never `window.recolt`.
 * Main pushes the document into it (`__stage.load(spec)`, JSON data), then places the camera
 * tile by tile (`__stage.show(camera)`) before each `capturePage`. Rendering = the same node
 * components as the editor (post cards, notes, shapes, text), without chrome, without animation,
 * videos via their thumbnail, plain background.
 */
import { useEffect, useState } from 'react'
import type { ItemCard } from '../../../../../shared/dto/items'
import { aabb, rectsIntersect } from '../../../../../shared/spaces-geometry'
import type { Camera, SpaceNode } from '../../../../../shared/spaces-schema'
import { NodeContent } from '../editor/nodes/NodeContent'
import '../spaces.css'

export interface StageSpec {
  nodes: SpaceNode[]
  items: Record<string, ItemCard>
  theme: 'light' | 'dark'
  /** Output pixels per world unit (media level of detail). */
  outScale: number
  tile: { w: number; h: number }
}

interface StageApi {
  load(spec: StageSpec): Promise<void>
  show(camera: Camera): Promise<void>
}

declare global {
  interface Window {
    __stage?: StageApi
  }
}

let setSpecRef: ((s: StageSpec) => void) | null = null
let setCameraRef: ((c: Camera) => void) | null = null
let committed: (() => void) | null = null

const frame = () =>
  new Promise<void>((resolve) => {
    // A lone rAF may never fire in a hidden page: race it against a timeout.
    let done = false
    const fin = () => {
      if (done) return
      done = true
      resolve()
    }
    requestAnimationFrame(() => fin())
    setTimeout(fin, 50)
  })

const decoded = new WeakSet<HTMLImageElement>()

async function settle(): Promise<void> {
  await frame()
  const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img'))
  const fresh = imgs.filter((img) => !decoded.has(img))
  await Promise.all(
    fresh.map((img) => {
      img.loading = 'eager'
      return img
        .decode()
        .catch(() => undefined)
        .then(() => decoded.add(img))
    }),
  )
  await document.fonts.ready
  // Wait only if new images have just been decoded (paint still to come).
  if (fresh.length > 0) await new Promise((r) => setTimeout(r, 120))
  await frame()
}

window.__stage = {
  async load(spec) {
    document.documentElement.dataset.theme = spec.theme
    await new Promise<void>((resolve) => {
      committed = resolve
      setSpecRef?.(spec)
    })
  },
  async show(camera) {
    await new Promise<void>((resolve) => {
      committed = resolve
      setCameraRef?.(camera)
    })
    await settle()
  },
}

export default function StageRoot() {
  const [spec, setSpec] = useState<StageSpec | null>(null)
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 })
  useEffect(() => {
    setSpecRef = setSpec
    setCameraRef = setCamera
    document.documentElement.dataset.stageReady = '1'
    return () => {
      setSpecRef = null
      setCameraRef = null
    }
  }, [])
  useEffect(() => {
    const c = committed
    committed = null
    c?.()
  }, [spec, camera])
  if (!spec) return <div data-stage="empty" />
  // Culling: the tile + a margin.
  const view = {
    x: -camera.x / camera.zoom - 200,
    y: -camera.y / camera.zoom - 200,
    width: spec.tile.w / camera.zoom + 400,
    height: spec.tile.h / camera.zoom + 400,
  }
  const nodes = spec.nodes.filter((n) => rectsIntersect(aabb(n), view)).sort((a, b) => a.z - b.z)
  return (
    <div
      className="space-viewport"
      data-stage="ready"
      style={{ position: 'fixed', inset: 0, background: 'var(--bg)', contain: 'strict' }}
    >
      <div
        className="space-world"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
        {nodes.map((n) => {
          const opacity = (n.style as { opacity?: number }).opacity
          return (
            <div
              key={n.uuid}
              className="space-node"
              data-type={n.type}
              style={{
                width: n.width,
                height: n.height,
                transform: `translate(${n.x}px, ${n.y}px) rotate(${n.rotation}deg)`,
                zIndex: n.z,
                ...(opacity !== undefined && opacity < 1 ? { opacity } : {}),
              }}
            >
              <div className="node-content">
                <NodeContent
                  node={n}
                  card={n.type === 'item' && n.itemUuid ? spec.items[n.itemUuid] : undefined}
                  editing={false}
                  screenScale={spec.outScale}
                  videoActive={false}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
