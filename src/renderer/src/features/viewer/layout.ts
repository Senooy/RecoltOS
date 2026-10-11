/**
 * Géométrie de la vue détail (DESIGN §3.7, recalée sur `cfj0gf` ×1,072) : barre du haut de 45 pt,
 * panneau Détails de 300 pt à `right: 18 ; top: 62 ; bottom: 18`, scène de `x = 0` à `W − 288`
 * (média centré à x ≈ 496 pour W = 1280), média en `contain` avec une marge de 54 × 40 et, pour une
 * vidéo, 48 pt réservés au lecteur placé 4 pt sous le média (le média seul reste centré).
 */

export const TOPBAR_H = 45
export const PANEL_W = 300
export const PANEL_RIGHT = 18
export const PANEL_TOP = 62
export const PANEL_BOTTOM = 18
/** Largeur retirée à droite de la scène quand le panneau est affiché. */
export const STAGE_RIGHT_INSET = 288
export const STAGE_PAD_X = 54
export const STAGE_PAD_Y = 40
export const PLAYER_H = 44
export const PLAYER_GAP = 4
/** Retrait du lecteur de chaque côté du média. */
export const PLAYER_INSET = 12
/** Largeur d'un post sans média dans la scène (ERRATA §C). */
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
 * Rectangle du média ajusté (`contain`) dans la scène, à 100 % de zoom. `reserve` = hauteur gardée
 * sous le média (lecteur vidéo, indicateur de slides) : elle limite la taille sans décentrer le média.
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

/** Rectangle zoomé (facteur `zoom`, 1 = ajusté) autour du centre, décalé de `pan`. */
export function zoomRect(fit: Rect, zoom: number, pan: { x: number; y: number }): Rect {
  const w = fit.w * zoom
  const h = fit.h * zoom
  return { x: fit.x + (fit.w - w) / 2 + pan.x, y: fit.y + (fit.h - h) / 2 + pan.y, w, h }
}

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 3
export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

/** Paliers de ⌘+ / ⌘− (en fraction). */
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5, 3]

export function zoomStep(z: number, dir: 1 | -1): number {
  if (dir > 0) return STEPS.find((s) => s > z + 0.001) ?? ZOOM_MAX
  return [...STEPS].reverse().find((s) => s < z - 0.001) ?? ZOOM_MIN
}

/** Le déplacement est borné pour qu'au moins la moitié de la scène reste couverte. */
export function clampPan(fit: Rect, zoom: number, pan: { x: number; y: number }) {
  if (zoom <= 1) return { x: 0, y: 0 }
  const mx = (fit.w * zoom - fit.w) / 2 + fit.w / 4
  const my = (fit.h * zoom - fit.h) / 2 + fit.h / 4
  return { x: Math.max(-mx, Math.min(mx, pan.x)), y: Math.max(-my, Math.min(my, pan.y)) }
}
