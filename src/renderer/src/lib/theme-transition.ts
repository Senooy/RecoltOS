/**
 * Animated theme switch. The new theme spreads from the control that asked for it (a circle that
 * grows until it covers the window), then resonates as it lands: two tinted ghosts swing on both
 * sides of the wavefront with a decaying amplitude and fade, while the interface trembles slightly
 * and settles sharp. The theme icon of the header resonates along (`styles/theme-transition.css`).
 *
 * Built on a View Transition of the whole document (bottom to top):
 *  - `::view-transition-old(root)`: static snapshot of the old theme;
 *  - `::view-transition-new(root)`: the new theme, the whole document, live, clipped by a circle
 *    that grows from the origin until well beyond the farthest corner;
 *  - `theme-ghost-left` / `theme-ghost-right`: two thin tinted rings (4 px elements stretched to
 *    the window, clipped by an evenodd ring path) riding the wavefront, shifted sideways.
 * When the circle has covered the window, what shows is already exactly the final state.
 * Only `clip-path`, `transform` and `opacity` are animated, with concrete values (WAAPI), on images
 * the compositor already holds. No DOM is cloned: every `<video>` keeps playing in place and the
 * registry of `video-guard` is left alone.
 *
 * Falls back to the instant switch (`apply`) when animation is unwanted or impossible: reduced
 * motion, e2e mode, hidden window, open detail view (immersive, the theme does not show there and
 * its video would be frozen outside the circle), no View Transition support, non-document root.
 */
import { isReducedMotion } from '../components/ui/motion'
import { VIEWER_SELECTOR } from './video-guard'

export type DocumentTheme = 'light' | 'dark'

/** Growth of the circle until it covers the farthest corner. */
export const WAVE_MS = 900
/** Tremor of the new theme. */
export const CORE_MS = 1000
/** Swing of the chromatic ghosts; also the total duration of the transition. */
export const GHOST_MS = 1100

const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const EASE_SWING = 'cubic-bezier(0.33, 1, 0.68, 1)'
/** Curve of the spreading circle. */
const EASE_WAVE = 'cubic-bezier(0.4, 0, 0.2, 1)'

/** An origin older than this is ignored (the change did not come from that control). */
const ORIGIN_TTL_MS = 1000

/** Horizontal swing of the ghosts at its widest, in px (decays to 0). */
const GHOST_AMP_PX = 14
/** Swing of the ghosts: [offset, × amplitude] (sign flipped for the left one). */
const GHOST_SWING: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0.22, -0.53],
  [0.38, 0.28],
  [0.54, -0.14],
  [0.7, 0.06],
  [0.84, -0.02],
  [1, 0],
]
/** Opacity of the ghosts: [offset, opacity]. */
const GHOST_OPACITY: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.1, 0.55],
  [0.54, 0.4],
  [0.84, 0.15],
  [1, 0],
]

/**
 * Tremor of the new theme: [offset, translateX px, scale]. The scale always exceeds the
 * translation at the window edges (scale about the center): the old theme never shows on a side.
 */
const CORE_KEYS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 3, 1.006],
  [0.3, -1.2, 1.0025],
  [0.55, 0.4, 1.001],
  [0.75, -0.12, 1.0003],
  [1, 0, 1],
]

/** Thickness of the chromatic rings, in px, just outside the front. */
const RING_PX = 14

const NEW = '::view-transition-new(root)'
const GHOSTS = [
  { side: 'left', dir: -1, pseudo: '::view-transition-new(theme-ghost-left)' },
  { side: 'right', dir: 1, pseudo: '::view-transition-new(theme-ghost-right)' },
] as const

let origin: { x: number; y: number; at: number } | null = null
/** Theme asked for by a transition whose update has not run yet. */
let pending: DocumentTheme | null = null
let active: { vt: ViewTransition; gen: number } | null = null
let gen = 0
let ghosts: HTMLElement[] = []

/**
 * Center of the control that is about to change the theme: the next change spreads from there
 * (once). Without one, or keyboard shortcut, menu, system appearance: center of the window.
 */
export function setThemeTransitionOrigin(el: Element | null | undefined): void {
  if (!el || !el.isConnected || el === document.body || el === document.documentElement) {
    origin = null
    return
  }
  const r = el.getBoundingClientRect()
  origin = { x: r.left + r.width / 2, y: r.top + r.height / 2, at: performance.now() }
}

function takeOrigin(w: number, h: number): { x: number; y: number } {
  const o = origin
  origin = null
  if (o && performance.now() - o.at < ORIGIN_TTL_MS) {
    return { x: Math.min(Math.max(o.x, 0), w), y: Math.min(Math.max(o.y, 0), h) }
  }
  return { x: w / 2, y: h / 2 }
}

function canAnimate(root: HTMLElement): boolean {
  if (typeof document === 'undefined' || root !== document.documentElement) return false
  if (typeof document.startViewTransition !== 'function') return false
  if (root.dataset.e2e === '1' || !root.dataset.theme) return false
  if (document.visibilityState !== 'visible') return false
  if (isReducedMotion()) return false
  return document.querySelector(VIEWER_SELECTOR) === null
}

function cleanup(root: HTMLElement): void {
  delete root.dataset.themeWave
  delete root.dataset.themeResonance
  for (const g of ghosts) g.remove()
  ghosts = []
}

/** Ends the running transition at once (its pending update, if any, becomes a no-op). */
function settle(root: HTMLElement): void {
  gen++
  pending = null
  if (!active) return
  const { vt } = active
  active = null
  cleanup(root)
  vt.skipTransition()
}

function mountGhosts(): void {
  for (const { side } of GHOSTS) {
    const el = document.createElement('div')
    el.className = 'theme-wave-ghost'
    el.dataset.side = side
    el.setAttribute('aria-hidden', 'true')
    document.body.append(el)
    ghosts.push(el)
  }
}

function circle(r: number, x: number, y: number): string {
  return `circle(${r}px at ${x}px ${y}px)`
}

/** Ring between two circles (evenodd), each two arcs: the same commands for every radius. */
function ring(inner: number, outer: number, x: number, y: number): string {
  const sub = (r: number): string =>
    `M ${x - r} ${y} A ${r} ${r} 0 1 0 ${x + r} ${y} A ${r} ${r} 0 1 0 ${x - r} ${y} Z`
  return `path(evenodd, "${sub(outer)} ${sub(inner)}")`
}

function run(root: HTMLElement, x: number, y: number, w: number, h: number): void {
  // Well beyond the farthest corner: the last corners are covered while the front is still
  // moving, instead of crawling in at the very end and snapping full when the transition ends.
  const radius = Math.ceil(Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) * 1.25) + 8
  const clip = { clipPath: [circle(0, x, y), circle(radius, x, y)] }
  // Rings on the front: inner radius = radius of the wave, at every instant (same curve).
  const rings = { clipPath: [ring(0, RING_PX, x, y), ring(radius, radius + RING_PX, x, y)] }
  // The swing starts in the direction the wave travels.
  const phase = x > w / 2 ? -1 : 1
  // Eases out without a long crawling tail, so the front keeps travelling until the window is covered.
  const wave = { duration: WAVE_MS, easing: EASE_WAVE, fill: 'both' } as const
  root.animate(clip, { ...wave, pseudoElement: NEW })
  root.animate(
    CORE_KEYS.map(([offset, tx, s]) => ({
      offset,
      easing: EASE_OUT,
      transform: `translateX(${tx * phase}px) scale(${s})`,
    })),
    { duration: CORE_MS, fill: 'backwards', pseudoElement: NEW },
  )
  for (const { dir, pseudo } of GHOSTS) {
    root.animate(rings, { ...wave, pseudoElement: pseudo })
    root.animate(
      GHOST_SWING.map(([offset, swing]) => ({
        offset,
        easing: EASE_SWING,
        transform: `translateX(${swing * dir * phase * GHOST_AMP_PX}px)`,
      })),
      { duration: GHOST_MS, fill: 'backwards', pseudoElement: pseudo },
    )
    root.animate(
      GHOST_OPACITY.map(([offset, opacity]) => ({ offset, easing: EASE_SWING, opacity })),
      { duration: GHOST_MS, fill: 'backwards', pseudoElement: pseudo },
    )
  }
}

/**
 * Shows `theme` on `root`: animated when possible, otherwise `apply()` right away. `apply` performs
 * the actual switch (`data-theme`, with the CSS transitions of the components cut for that frame).
 * Repeated calls for the theme already shown or on its way are no-ops.
 */
export function transitionTheme(
  theme: DocumentTheme,
  root: HTMLElement,
  apply: () => void,
  animate = true,
): void {
  if ((pending ?? root.dataset.theme) === theme) return
  if (!animate || !canAnimate(root)) {
    settle(root)
    apply()
    return
  }
  settle(root)
  const id = gen
  const w = window.innerWidth
  const h = window.innerHeight
  const { x, y } = takeOrigin(w, h)
  pending = theme
  const vt = document.startViewTransition(() => {
    if (id !== gen) return
    pending = null
    apply()
    // The ghosts exist in the new state only; the resonance of the icon starts.
    root.dataset.themeWave = '1'
    root.dataset.themeResonance = '1'
    mountGhosts()
  })
  active = { vt, gen: id }
  vt.ready.then(
    () => {
      if (id === gen) run(root, x, y, w, h)
    },
    () => undefined,
  )
  vt.finished.then(
    () => {
      if (id !== gen) return
      active = null
      cleanup(root)
    },
    () => undefined,
  )
  vt.updateCallbackDone.catch(() => undefined)
}
