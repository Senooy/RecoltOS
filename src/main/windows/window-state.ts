/**
 * `window-state.json`: bounds, display, maximized; restored at launch
 * (except in e2e). Testable pure functions + atomic I/O.
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
 * Bounds to apply at launch.
 * - Saved position is kept if at least 25 % of the window (and 100×60 px) stays visible
 *   on a current display; size is clamped to that display's workArea (and at least 1040×620).
 * - Otherwise (display unplugged, file missing or invalid): `DEFAULT_WINDOW` (1280×820), position
 *   left to macOS (centering). The saved size is never reused on an unknown display.
 */
export function pickRestoreBounds(
  state: WindowState | null,
  displays: readonly DisplayLike[],
): {
  bounds: Partial<Rect> & { width: number; height: number }
  maximize: boolean
  fullScreen: boolean
} {
  const fallback = { bounds: { ...DEFAULT_WINDOW }, maximize: false, fullScreen: false }
  if (!state) return fallback
  const b = {
    ...state.bounds,
    width: Math.max(MIN_WINDOW.width, state.bounds.width),
    height: Math.max(MIN_WINDOW.height, state.bounds.height),
  }
  let target: DisplayLike | null = null
  let best = 0
  for (const d of displays) {
    const area = intersection(b, d.workArea)
    if (area > best) {
      best = area
      target = d
    }
  }
  const visible = target !== null && best >= 0.25 * b.width * b.height && best >= 100 * 60
  if (!visible || !target) return fallback
  const workArea = target.workArea
  const width = Math.min(b.width, Math.max(MIN_WINDOW.width, workArea.width))
  const height = Math.min(b.height, Math.max(MIN_WINDOW.height, workArea.height))
  return {
    bounds: { x: b.x, y: b.y, width, height },
    maximize: state.isMaximized,
    fullScreen: state.isFullScreen,
  }
}

export function readWindowState(userData: string): WindowState | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(userData, WINDOW_STATE_FILE), 'utf8'))
    return parseWindowState(raw)
  } catch {
    return null
  }
}

/** Atomic write: `.tmp` then `rename`. */
export function writeWindowState(userData: string, state: WindowState): void {
  const file = path.join(userData, WINDOW_STATE_FILE)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}
