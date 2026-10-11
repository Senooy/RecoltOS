/**
 * `NodeView` (SPACES §1.4.1) : boîte absolue `translate(x,y) rotate(r)` de taille `w × h` ; le
 * contenu est inerte (`.node-content { pointer-events: none }`), le hit-test se fait sur
 * `.space-node`. Mémoïsé : ne se re-rend que si SON nœud, SA prévisualisation, son état d'édition,
 * sa vidéo ou le palier de niveau de détail changent (jamais à chaque image de pan/zoom).
 */
import { memo } from 'react'
import { create } from 'zustand'
import { NodeContent } from './nodes/NodeContent'
import { useCamera, useSpace } from './store/spaceStore'

/** Vidéos actives (≤ 3, SPACES §1.4.4), calculées par le viewport en fin de geste. */
export const useVideos = create<{ ids: readonly string[] }>()(() => ({ ids: [] }))

/** Paliers du niveau de détail (zoom × densité) : re-rendu seulement au franchissement. */
const LOD_STEPS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8]
export function lodOf(zoom: number, dpr: number): number {
  const v = zoom * dpr
  return LOD_STEPS.find((s) => s >= v - 1e-6) ?? 8
}

export function useScreenScale(stageScale?: number): number {
  const z = useCamera((s) => s.settled.zoom)
  return stageScale ?? lodOf(z, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
}

export const NodeView = memo(function NodeView({
  id,
  stageScale,
}: {
  id: string
  /** Fenêtre stage : échelle fixée par le main, pas de vidéo, pas d'édition. */
  stageScale?: number
}) {
  const node = useSpace((s) => s.nodes[id])
  const pv = useSpace((s) => s.preview?.[id])
  const editing = useSpace((s) => s.editingId === id)
  const card = useSpace((s) => {
    const n = s.nodes[id]
    return n && n.type === 'item' && n.itemUuid ? s.items[n.itemUuid] : undefined
  })
  const video = useVideos((s) => s.ids.includes(id)) && stageScale === undefined
  const screenScale = useScreenScale(stageScale)
  if (!node) return null
  const b = pv ? { ...node, ...pv } : node
  const opacity = (node.style as { opacity?: number }).opacity
  return (
    <div
      className="space-node"
      data-node={id}
      data-type={node.type}
      data-locked={node.locked ? '1' : undefined}
      data-editing={editing ? '1' : undefined}
      style={{
        width: b.width,
        height: b.height,
        transform: `translate(${b.x}px, ${b.y}px) rotate(${b.rotation}deg)`,
        zIndex: node.z,
        ...(opacity !== undefined && opacity < 1 ? { opacity } : {}),
      }}
    >
      <div className="node-content">
        <NodeContent
          node={pv ? { ...node, ...pv } : node}
          card={card}
          editing={editing && stageScale === undefined}
          screenScale={screenScale}
          videoActive={video}
        />
      </div>
    </div>
  )
})
