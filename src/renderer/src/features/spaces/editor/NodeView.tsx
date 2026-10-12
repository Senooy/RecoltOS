/**
 * `NodeView`: absolute box `translate(x,y) rotate(r)` of size `w × h`; the
 * content is inert (`.node-content { pointer-events: none }`), hit-testing happens on
 * `.space-node`. Memoized: re-renders only if ITS node, ITS preview, its edit state,
 * its video or the detail-level step changes (never on every pan/zoom frame).
 */
import { memo } from 'react'
import { create } from 'zustand'
import { NodeContent } from './nodes/NodeContent'
import { useCamera, useSpace } from './store/spaceStore'

/** Active videos (≤ 2), computed by the viewport at the end of the gesture. */
export const useVideos = create<{ ids: readonly string[] }>()(() => ({ ids: [] }))

/** Detail-level steps (zoom × density): re-rendered only when a step is crossed. */
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
  /** Stage window: scale set by main, no video, no editing. */
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
