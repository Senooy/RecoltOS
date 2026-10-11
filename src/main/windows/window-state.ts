/**
 * `window-state.json` (ERRATA §B) : bornes, écran, maximisé ; restauré au lancement
 * (sauf en e2e). Fonctions pures testables + E/S atomiques.
 */
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { DEFAULT_WINDOW, MIN_WINDOW } from '../bootstrap/env'

export const WINDOW_STATE_FILE = 'window-state.json'

const Rect = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
})
export type Rect = z.output<typeof Rect>

export const WindowStateSchema = z.object({
  version: z.literal(1).default(1),
  bounds: Rect,
  displayId: z.number().nullable().default(null),
  isMaximized: z.boolean().default(false),
  isFullScreen: z.boolean().default(false),
})
export type WindowState = z.output<typeof WindowStateSchema>

export interface DisplayLike {
  id: number
  workArea: Rect
}

export function parseWindowState(raw: unknown): WindowState | null {
  const r = WindowStateSchema.safeParse(raw)
  return r.success ? r.data : null
}

function intersection(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * Bornes à appliquer : celles sauvegardées si au moins 25 % de la fenêtre (et 100×60 px)
 * reste visible sur un écran actuel, sinon taille par défaut centrée (position laissée à macOS).
 */
export function pickRestoreBounds(
  state: WindowState | null,
  displays: readonly DisplayLike[],
): { bounds: Partial<Rect> & { width: number; height: number }; maximize: boolean } {
  const fallback = { bounds: { ...DEFAULT_WINDOW }, maximize: false }
  if (!state) return fallback
  const b = {
    ...state.bounds,
    width: Math.max(MIN_WINDOW.width, state.bounds.width),
    height: Math.max(MIN_WINDOW.height, state.bounds.height),
  }
  const visible = displays.some((d) => {
    const area = intersection(b, d.workArea)
    return area >= 0.25 * b.width * b.height && area >= 100 * 60
  })
  if (!visible) return { bounds: { width: b.width, height: b.height }, maximize: state.isMaximized }
  return { bounds: b, maximize: state.isMaximized }
}

export function readWindowState(userData: string): WindowState | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(userData, WINDOW_STATE_FILE), 'utf8'))
    return parseWindowState(raw)
  } catch {
    return null
  }
}

/** Écriture atomique : `.tmp` puis `rename`. */
export function writeWindowState(userData: string, state: WindowState): void {
  const file = path.join(userData, WINDOW_STATE_FILE)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}
