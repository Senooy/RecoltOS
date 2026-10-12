/**
 * FLIP manuel : carte → vue détail sur 340 ms `--ease-sheet`.
 * Aucun FLIP en mouvement réduit.
 */

export const SHEET_DURATION_MS = 340
export const SHEET_EASING = 'cubic-bezier(.32,.72,0,1)'

export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion === '1')
    return true
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface FlipOptions {
  duration?: number
  easing?: string
}

/** Anime `el` depuis le rectangle `from` (mesuré avant le changement de mise en page). */
export function flipFrom(el: HTMLElement, from: DOMRect, opts: FlipOptions = {}): Animation | null {
  if (prefersReducedMotion() || typeof el.animate !== 'function') return null
  const to = el.getBoundingClientRect()
  if (to.width === 0 || to.height === 0) return null
  const dx = from.left - to.left
  const dy = from.top - to.top
  const sx = from.width / to.width
  const sy = from.height / to.height
  return el.animate(
    [
      { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: 'top left', transform: 'none' },
    ],
    { duration: opts.duration ?? SHEET_DURATION_MS, easing: opts.easing ?? SHEET_EASING },
  )
}
