/**
 * Screen overlay for the selection: 1.5 px blue outline, 8 white 8×8 handles edged in blue,
 * rotation handle, dotted frame without handles for a multiple selection, marquee (8 % blue fill),
 * pink alignment guides. Constant thickness on screen: only this overlay follows the camera
 * on every frame.
 */
import type { SpaceNode } from '../../../../../../shared/spaces-schema'
import { aabb, unionRect } from '../../../../../../shared/spaces-geometry'
import { worldToScreen } from '../geometry/camera'
import { HANDLES, HANDLE_DIR, handlePoint } from '../geometry/resize'
import { useCamera, useSpace } from '../store/spaceStore'

const SELECT = 'var(--sp-select)'
const HANDLE = 8
const ROTATE_OFFSET = 22

/**
 * Only follows the camera when it has something to draw: with nothing selected, panning and
 * zooming commit no React render at all.
 */
export function SelectionOverlay({ interacting }: { interacting: boolean }) {
  const active = useSpace(
    (s) => s.selection.length > 0 || s.marquee !== null || s.guides.length > 0,
  )
  return active ? (
    <LiveOverlay interacting={interacting} />
  ) : (
    <svg className="space-overlay" data-testid="space-overlay" aria-hidden="true" />
  )
}

function LiveOverlay({ interacting }: { interacting: boolean }) {
  const camera = useCamera((s) => s.camera)
  const selection = useSpace((s) => s.selection)
  const nodes = useSpace((s) => s.nodes)
  const preview = useSpace((s) => s.preview)
  const marquee = useSpace((s) => s.marquee)
  const guides = useSpace((s) => s.guides)
  const editingId = useSpace((s) => s.editingId)
  const sel = selection
    .map((id) => {
      const n = nodes[id]
      if (!n) return null
      const pv = preview?.[id]
      return pv ? { ...n, ...pv } : n
    })
    .filter((n): n is SpaceNode => n !== null)
  const toS = (x: number, y: number) => worldToScreen(camera, { x, y })
  const outline = (n: SpaceNode) =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]
      .map(([sx, sy]) => {
        const p = handlePoint(n, sx!, sy!)
        const s = toS(p.x, p.y)
        return `${s.x},${s.y}`
      })
      .join(' ')
  const single = sel.length === 1 ? sel[0]! : null
  const showHandles = single && !single.locked && editingId !== single.uuid && !interacting
  const multi = sel.length > 1 ? unionRect(sel.map(aabb)) : null
  return (
    <svg className="space-overlay" data-testid="space-overlay" aria-hidden="true">
      {sel.map((n) => (
        <polygon
          key={n.uuid}
          points={outline(n)}
          fill="none"
          stroke={SELECT}
          strokeWidth={1.5}
          strokeDasharray={n.locked ? '4 3' : undefined}
        />
      ))}
      {multi
        ? (() => {
            const a = toS(multi.x, multi.y)
            const b = toS(multi.x + multi.width, multi.y + multi.height)
            return (
              <rect
                x={a.x - 4}
                y={a.y - 4}
                width={b.x - a.x + 8}
                height={b.y - a.y + 8}
                fill="none"
                stroke={SELECT}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            )
          })()
        : null}
      {showHandles && single
        ? (() => {
            const top = handlePoint(single, 0, -1)
            const ts = toS(top.x, top.y)
            const r = (single.rotation * Math.PI) / 180
            const rx = ts.x + Math.sin(r) * ROTATE_OFFSET
            const ry = ts.y - Math.cos(r) * ROTATE_OFFSET
            return (
              <>
                <line x1={ts.x} y1={ts.y} x2={rx} y2={ry} stroke={SELECT} strokeWidth={1} />
                <circle
                  className="sp-handle"
                  data-rotate="1"
                  data-testid="rotate-handle"
                  cx={rx}
                  cy={ry}
                  r={5}
                  fill="#fff"
                  stroke={SELECT}
                  strokeWidth={1.5}
                  style={{ cursor: 'grab' }}
                />
                {HANDLES.map((h) => {
                  const [sx, sy] = HANDLE_DIR[h]
                  const hp = handlePoint(single, sx, sy)
                  const p = toS(hp.x, hp.y)
                  return (
                    <rect
                      key={h}
                      className="sp-handle"
                      data-handle={h}
                      data-testid={`handle-${h}`}
                      x={p.x - HANDLE / 2}
                      y={p.y - HANDLE / 2}
                      width={HANDLE}
                      height={HANDLE}
                      fill="#fff"
                      stroke={SELECT}
                      strokeWidth={1.5}
                      transform={`rotate(${single.rotation} ${p.x} ${p.y})`}
                      style={{ cursor: cursorFor(h, single.rotation) }}
                    />
                  )
                })}
              </>
            )
          })()
        : null}
      {marquee
        ? (() => {
            const a = toS(marquee.x, marquee.y)
            return (
              <rect
                data-testid="marquee"
                x={a.x}
                y={a.y}
                width={marquee.width * camera.zoom}
                height={marquee.height * camera.zoom}
                fill="rgba(10,132,255,.08)"
                stroke={SELECT}
                strokeWidth={1}
              />
            )
          })()
        : null}
      {guides.map((g, i) => {
        const a = g.axis === 'x' ? toS(g.at, g.from) : toS(g.from, g.at)
        const b = g.axis === 'x' ? toS(g.at, g.to) : toS(g.to, g.at)
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="var(--sp-guide)"
            strokeWidth={1}
          />
        )
      })}
    </svg>
  )
}

const CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'] as const
function cursorFor(h: keyof typeof HANDLE_DIR, rotation: number): string {
  const base: Record<string, number> = { n: 0, ne: 1, e: 2, se: 3, s: 0, sw: 1, w: 2, nw: 3 }
  const steps = Math.round((((rotation % 180) + 180) % 180) / 45)
  return CURSORS[(base[h]! + steps) % 4]!
}
