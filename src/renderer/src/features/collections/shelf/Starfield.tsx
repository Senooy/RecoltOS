/**
 * `Starfield`: full-frame 2D canvas, ≈ 220 stars for 1280×820 (density ∝ area), radius
 * 0.5–1.3 px, opacity 0.15–0.9. Drawn ONCE (mount and resize), never per frame: a canvas
 * redrawn in a rAF loop re-uploads a full-screen texture at every vsync and damages the whole
 * frame, so every 3D slice is recomposited even when nothing moves. The 2 px parallax tied to
 * the horizontal scrolling is a `transform` of the canvas layer, written by the shelf's scroll
 * loop through the forwarded ref (no React render, no repaint).
 * Deterministic draw (fixed seed): reproducible captures.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

export const STARS_PER_PX = 220 / (1280 * 820)
/** Maximum parallax offset (px) at the end of the track. */
export const STAR_PARALLAX_PX = 2

interface Star {
  x: number
  y: number
  r: number
  a: number
  /** Kept for the deterministic draw (seeded sequence); the field no longer twinkles. */
  twinkle: boolean
  period: number
  phase: number
}

/** Pseudo-random generator (mulberry32). */
export function rng(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

export function makeStars(width: number, height: number, seed = 7): Star[] {
  const rand = rng(seed)
  const n = Math.round(width * height * STARS_PER_PX)
  return Array.from({ length: n }, () => ({
    x: rand() * (width + 4) - 2,
    y: rand() * height,
    r: 0.5 + rand() * 0.8,
    a: 0.15 + rand() * 0.75,
    twinkle: rand() < 0.1,
    period: 3000 + rand() * 3000,
    phase: rand() * Math.PI * 2,
  }))
}

export interface StarfieldHandle {
  /** Parallax ∈ [0, 1] (scroll / max scroll): moves the canvas layer, nothing is redrawn. */
  setParallax: (p: number) => void
}

export const Starfield = forwardRef<StarfieldHandle>(function Starfield(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useImperativeHandle(
    ref,
    () => ({
      setParallax(p: number) {
        const c = canvasRef.current
        if (c)
          c.style.transform = `translate3d(${(-STAR_PARALLAX_PX * 0.85 * p).toFixed(2)}px, 0, 0)`
      },
    }),
    [],
  )
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let lastW = -1
    let lastH = -1
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === lastW && h === lastH) return
      lastW = w
      lastH = h
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#fff'
      for (const s of makeStars(w, h)) {
        ctx.globalAlpha = Math.max(0, Math.min(1, s.a))
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])
  return (
    <canvas
      ref={canvasRef}
      data-testid="starfield"
      aria-hidden="true"
      className="shelf-stars pointer-events-none absolute inset-0 h-full w-full"
    />
  )
})
