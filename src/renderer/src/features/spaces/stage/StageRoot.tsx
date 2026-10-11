/**
 * Fenêtre « stage » (SPACES §1.9, WP-63) : `offscreen.html?render=space-stage`, sans preload, jamais
 * `window.recolt`. Le main y pousse le document (`__stage.load(spec)`, données JSON) puis place la
 * caméra tuile par tuile (`__stage.show(camera)`) avant chaque `capturePage`. Rendu = les mêmes
 * composants de nœuds que l'éditeur (cartes de post, notes, formes, texte), sans chrome, sans
 * animation, vidéos par leur vignette, fond uni.
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
  /** Pixels de sortie par unité monde (niveau de détail des médias). */
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
    // Un rAF seul peut ne jamais tirer dans une page cachée : course avec un délai.
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
  // « Settle » seulement si de nouvelles images viennent d'être décodées (peinture à venir).
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
  // Culling : la tuile + une marge.
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
