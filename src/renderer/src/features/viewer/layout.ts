/**
 * Geometry of the detail view: 45 pt top bar,
 * 300 pt Details panel at `right: 18 ; top: 62 ; bottom: 18`, scene from `x = 0` to `W − 288`
 * (media centered at x ≈ 496 for W = 1280), media in `contain` with a 54 × 40 margin and, for a
 * video, 48 pt reserved for the player placed 4 pt below the media (the media alone stays centered).
 */

export const TOPBAR_H = 45
export const PANEL_W = 300
export const PANEL_RIGHT = 18
export const PANEL_TOP = 62
export const PANEL_BOTTOM = 18
/** Width removed from the right of the scene when the panel is shown. */
export const STAGE_RIGHT_INSET = 288
export const STAGE_PAD_X = 54
export const STAGE_PAD_Y = 40
export const PLAYER_H = 44
export const PLAYER_GAP = 4
/** Player inset on each side of the media. */
export const PLAYER_INSET = 12
/** Width of a post without media in the scene. */
export const TWEET_DETAIL_W = 560

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function stageRect(winW: number, winH: number, panelOpen: boolean): Rect {
  const w = Math.max(200, winW - (panelOpen ? STAGE_RIGHT_INSET : 0))
  return { x: 0, y: TOPBAR_H, w, h: Math.max(200, winH - TOPBAR_H) }
}

/**
 * Rectangle of the media fitted (`contain`) in the scene, at 100 % zoom. `reserve` = height kept
 * below the media (video player, slide indicator): it limits the size without off-centering the media.
 */
export function fitMedia(
  stage: Rect,
  mediaW: number | null,
  mediaH: number | null,
  reserve = 0,
): Rect {
  const maxW = Math.max(40, stage.w - 2 * STAGE_PAD_X)
  const maxH = Math.max(40, stage.h - 2 * STAGE_PAD_Y - reserve)
  const ratio = mediaW && mediaH && mediaW > 0 && mediaH > 0 ? mediaW / mediaH : 1
  let w = maxW
  let h: number = w / ratio
  if (h > maxH) {
    h = maxH
    w = h * ratio
  }
  return {
    x: stage.x + (stage.w - w) / 2,
    y: stage.y + (stage.h - h) / 2,
    w,
    h,
  }
}

/** Zoomed rectangle (`zoom` factor, 1 = fitted) around the center, offset by `pan`. */
export function zoomRect(fit: Rect, zoom: number, pan: { x: number; y: number }): Rect {
  const w = fit.w * zoom
  const h = fit.h * zoom
  return { x: fit.x + (fit.w - w) / 2 + pan.x, y: fit.y + (fit.h - h) / 2 + pan.y, w, h }
}

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 3
export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

/** Steps of ⌘+ / ⌘− (as a fraction). */
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5, 3]

export function zoomStep(z: number, dir: 1 | -1): number {
  if (dir > 0) return STEPS.find((s) => s > z + 0.001) ?? ZOOM_MAX
  return [...STEPS].reverse().find((s) => s < z - 0.001) ?? ZOOM_MIN
}

/** Panning is bounded so that at least half of the scene stays covered. */
export function clampPan(fit: Rect, zoom: number, pan: { x: number; y: number }) {
  if (zoom <= 1) return { x: 0, y: 0 }
  const mx = (fit.w * zoom - fit.w) / 2 + fit.w / 4
  const my = (fit.h * zoom - fit.h) / 2 + fit.h / 4
  return { x: Math.max(-mx, Math.min(mx, pan.x)), y: Math.max(-my, Math.min(my, pan.y)) }
}
