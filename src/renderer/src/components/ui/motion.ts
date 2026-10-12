/**
 * Motion and `prefers-reduced-motion`.
 *
 * Reduced motion (system OR the "Always" preference, set by `state/prefs.ts` on
 * `<html data-reduce-motion="1">`): durations ≤ 80 ms, no rotation, translation or scaling
 * (fades only). `ui.css` mirrors the same rule for CSS animations; this module serves the
 * JS-driven animations (motion, WAAPI) and fixes the tested contract.
 */
import { useSyncExternalStore } from 'react'

/** Design system durations, in ms (mirror of the `--dur-*` of `globals.css`). */
export const DURATION = {
  instant: 80,
  fast: 120,
  base: 180,
  slow: 240,
  sheet: 340,
  menuIn: 140,
  menuOut: 100,
} as const

/** Duration cap in reduced motion. */
export const REDUCED_MAX_MS = 80

/** Tooltip appearance delay. */
export const TOOLTIP_DELAY_MS = 600

const QUERY = '(prefers-reduced-motion: reduce)'

/** True if the user asked for less motion (system or the "Always" setting). */
export function isReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion === '1') {
    return true
  }
  if (typeof matchMedia === 'function') {
    try {
      return matchMedia(QUERY).matches
    } catch {
      return false
    }
  }
  return false
}

/** Effective duration in ms: capped at 80 ms in reduced motion. */
export function motionDuration(ms: number, reduced: boolean = isReducedMotion()): number {
  const v = Math.max(0, ms)
  return reduced ? Math.min(v, REDUCED_MAX_MS) : v
}

/** Same duration in seconds (the `motion` / WAAPI API uses seconds). */
export function motionSeconds(ms: number, reduced: boolean = isReducedMotion()): number {
  return motionDuration(ms, reduced) / 1000
}

/** Animation properties that move, rotate or resize. */
const TRANSFORM_KEYS = [
  'x',
  'y',
  'z',
  'scale',
  'scaleX',
  'scaleY',
  'rotate',
  'rotateX',
  'rotateY',
  'rotateZ',
  'skew',
  'skewX',
  'skewY',
  'translate',
  'transform',
] as const

/**
 * Removes from the animation state any translation, rotation and scaling in reduced motion:
 * only opacity (and the other non-geometric properties) remain.
 */
export function reduceMotionState<T extends Record<string, unknown>>(
  state: T,
  reduced: boolean = isReducedMotion(),
): Partial<T> {
  if (!reduced) return state
  const out: Record<string, unknown> = { ...state }
  for (const k of TRANSFORM_KEYS) delete out[k]
  return out as Partial<T>
}

function subscribe(onChange: () => void): () => void {
  const disposers: Array<() => void> = []
  if (typeof document !== 'undefined') {
    const obs = new MutationObserver(onChange)
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-reduce-motion'],
    })
    disposers.push(() => obs.disconnect())
  }
  if (typeof matchMedia === 'function') {
    try {
      const mql = matchMedia(QUERY)
      mql.addEventListener('change', onChange)
      disposers.push(() => mql.removeEventListener('change', onChange))
    } catch {
      /* matchMedia unavailable: only the attribute is tracked */
    }
  }
  return () => {
    for (const d of disposers) d()
  }
}

/** Hook: true in reduced motion, updated live. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, isReducedMotion, () => false)
}
