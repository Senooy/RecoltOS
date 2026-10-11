/**
 * Caméra de la toile (SPACES §1.4.3) : `screen = world × zoom + (x, y)`. Zoom borné par le contrat
 * (`Camera.zoom` ∈ [0,1 ; 4], DESIGN §3.11 : 10–400 %). `zoomAt` garde fixe le point monde sous
 * l'ancre (invariant testé à 1e-9).
 */
import type { Rect, Vec } from '../../../../../../shared/spaces-geometry'
import type { Camera } from '../../../../../../shared/spaces-schema'

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
/** Paliers des boutons « − / + » et de ⌘+ / ⌘−. */
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export const screenToWorld = (c: Camera, p: Vec): Vec => ({
  x: (p.x - c.x) / c.zoom,
  y: (p.y - c.y) / c.zoom,
})

export const worldToScreen = (c: Camera, p: Vec): Vec => ({
  x: p.x * c.zoom + c.x,
  y: p.y * c.zoom + c.y,
})

export function zoomAt(c: Camera, anchor: Vec, next: number): Camera {
  const z = clampZoom(next)
  const k = z / c.zoom
  return { zoom: z, x: anchor.x - (anchor.x - c.x) * k, y: anchor.y - (anchor.y - c.y) * k }
}

/** Palier suivant (`dir = 1`) ou précédent (`-1`). */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > zoom + 1e-6) ?? MAX_ZOOM
  return [...ZOOM_STEPS].reverse().find((s) => s < zoom - 1e-6) ?? MIN_ZOOM
}

/** Caméra qui centre `box` dans une vue `w × h` avec une marge, zoom ≤ `maxZoom`. */
export function fitBox(view: { w: number; h: number }, box: Rect, pad = 64, maxZoom = 1): Camera {
  const bw = Math.max(1, box.width)
  const bh = Math.max(1, box.height)
  const z = clampZoom(
    Math.min(maxZoom, (view.w - 2 * pad) / bw, (view.h - 2 * pad) / bh) || MIN_ZOOM,
  )
  return {
    zoom: z,
    x: view.w / 2 - (box.x + bw / 2) * z,
    y: view.h / 2 - (box.y + bh / 2) * z,
  }
}

/** Rectangle monde visible. */
export function viewRect(c: Camera, view: { w: number; h: number }): Rect {
  return { x: -c.x / c.zoom, y: -c.y / c.zoom, width: view.w / c.zoom, height: view.h / c.zoom }
}

/** Agrandit un rectangle d'une fraction de sa taille de chaque côté (culling, SPACES §1.4.4). */
export function inflate(r: Rect, frac: number): Rect {
  const dx = r.width * frac
  const dy = r.height * frac
  return { x: r.x - dx, y: r.y - dy, width: r.width + 2 * dx, height: r.height + 2 * dy }
}

/** Vrai si `inner` est entièrement dans `outer`. */
export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

/** Molette (SPACES §1.4.3) : ⌃ = pincement, ⌘ ou réglage « zoomer » = zoom, sinon défilement. */
export function wheelAction(
  e: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean },
  wheelMode: 'scroll' | 'zoom',
  pageHeight: number,
): { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number } {
  const u = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageHeight : 1
  const dx = e.deltaX * u
  const dy = e.deltaY * u
  if (e.ctrlKey) return { kind: 'zoom', factor: Math.exp(-dy * 0.01) }
  if (e.metaKey || wheelMode === 'zoom') return { kind: 'zoom', factor: Math.exp(-dy * 0.0025) }
  return { kind: 'pan', dx: -dx, dy: -dy }
}
