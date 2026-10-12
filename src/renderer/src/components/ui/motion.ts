/**
 * Mouvement et `prefers-reduced-motion`.
 *
 * Mouvement réduit (système OU préférence « Toujours », posée par `state/prefs.ts` sur
 * `<html data-reduce-motion="1">`) : durées ≤ 80 ms, ni rotation ni translation ni mise à
 * l'échelle (fondus uniquement). `ui.css` reflète la même règle pour les animations CSS ; ce
 * module sert aux animations pilotées en JS (motion, WAAPI) et fixe le contrat testé.
 */
import { useSyncExternalStore } from 'react'

/** Durées du design system, en ms (miroir des `--dur-*` de `globals.css`). */
export const DURATION = {
  instant: 80,
  fast: 120,
  base: 180,
  slow: 240,
  sheet: 340,
  menuIn: 140,
  menuOut: 100,
} as const

/** Plafond des durées en mouvement réduit. */
export const REDUCED_MAX_MS = 80

/** Délai d'apparition des tooltips. */
export const TOOLTIP_DELAY_MS = 600

const QUERY = '(prefers-reduced-motion: reduce)'

/** Vrai si l'utilisateur a demandé moins de mouvement (système ou réglage « Toujours »). */
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

/** Durée effective en ms : plafonnée à 80 ms en mouvement réduit. */
export function motionDuration(ms: number, reduced: boolean = isReducedMotion()): number {
  const v = Math.max(0, ms)
  return reduced ? Math.min(v, REDUCED_MAX_MS) : v
}

/** Même durée en secondes (API `motion` / WAAPI en secondes). */
export function motionSeconds(ms: number, reduced: boolean = isReducedMotion()): number {
  return motionDuration(ms, reduced) / 1000
}

/** Propriétés d'animation qui déplacent, tournent ou redimensionnent. */
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
 * Retire de l'état d'animation toute translation, rotation et mise à l'échelle en mouvement
 * réduit : il ne reste que l'opacité (et les autres propriétés non géométriques).
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
      /* matchMedia indisponible : seul l'attribut est suivi */
    }
  }
  return () => {
    for (const d of disposers) d()
  }
}

/** Hook : vrai en mouvement réduit, mis à jour en direct. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, isReducedMotion, () => false)
}
