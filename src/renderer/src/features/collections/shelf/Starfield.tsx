/**
 * `Starfield` (DESIGN §3.4) : canvas 2D plein cadre, ≈ 220 étoiles pour 1280×820 (densité ∝
 * surface), rayon 0,5–1,3 px, opacité 0,15–0,9 ; 10 % scintillent (cycle 3–6 s) ; parallaxe de
 * 2 px liée au défilement horizontal (`parallax` ∈ [0, 1]). Statique (ni scintillement ni
 * parallaxe) en mouvement réduit.
 * Tirage déterministe (graine fixe) : captures reproductibles.
 */
import { useEffect, useRef } from 'react'

export const STARS_PER_PX = 220 / (1280 * 820)

interface Star {
  x: number
  y: number
  r: number
  a: number
  twinkle: boolean
  period: number
  phase: number
}

/** Générateur pseudo-aléatoire (mulberry32). */
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

export function Starfield({ parallax, still }: { parallax: number; still: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const parallaxRef = useRef(parallax)
  parallaxRef.current = parallax
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let stars: Star[] = []
    let w = 0
    let h = 0
    let raf = 0
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      stars = makeStars(w, h)
    }
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h)
      const dx = -2 * parallaxRef.current
      for (const s of stars) {
        let a = s.a
        if (s.twinkle && !still) a *= 0.55 + 0.45 * Math.sin((t / s.period) * Math.PI * 2 + s.phase)
        ctx.globalAlpha = Math.max(0, Math.min(1, a))
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.arc(s.x + dx * (0.5 + s.r / 2.6), s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      if (!still) raf = requestAnimationFrame(draw)
    }
    resize()
    draw(0)
    const ro = new ResizeObserver(() => {
      resize()
      if (still) draw(0)
    })
    ro.observe(canvas)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [still])
  return (
    <canvas
      ref={canvasRef}
      data-testid="starfield"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  )
}
