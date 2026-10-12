/**
 * Ambience layer of the detail view (inside `.viewer-backdrop`, whose opening and closing fades it
 * follows). The ambience is computed in an off-screen canvas of 96 × 60 px, then copied into
 * two visible canvases of the same size, stretched full-screen by the compositor (a tiny texture
 * enlarged: no tiles to rasterise, no PNG to encode then decode). Fixed order: the top canvas
 * receives the new ambience and fades it in (450 ms; instant with reduced motion); just before,
 * the visible image (fade in progress included) is frozen into the one below.
 * Both canvases remain stable composited layers for the whole view. Before, two stretched
 * backgrounds plus the grain were promoted to full-screen layers on every fade, then demoted
 * (≈ 23 MB of tiles each on Retina, re-rasterised at each navigation): that was most of the
 * view's tile memory and rasterisation work. Before the first draw, a gradient drawn from
 * the card's dominant colour fills the background. Video playing: the ambience follows the
 * current frame every 2 s.
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import {
  AMBIENCE_H,
  AMBIENCE_W,
  NEUTRAL,
  drawAmbience,
  parseHex,
  rgba,
  tintFrom,
  type AmbienceResult,
  type Rgb,
  type ViewerTint,
} from './ambience-engine'

export const AMBIENCE_FADE_MS = 450
export const VIDEO_REFRESH_MS = 2000

let grainUrl: string | null = null

/** Very light grain, as a tile (avoids banding in enlarged dark gradients). */
function grain(): string | null {
  if (grainUrl !== null) return grainUrl || null
  try {
    const c = Object.assign(document.createElement('canvas'), { width: 96, height: 96 })
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('2d')
    const img = ctx.createImageData(96, 96)
    // Fixed-seed pseudo-random: the grain is identical from one opening to the next.
    let seed = 0x2f6b1d
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rand() < 0.5 ? 0 : 255
      img.data[i] = v
      img.data[i + 1] = v
      img.data[i + 2] = v
      img.data[i + 3] = Math.round(rand() * 4)
    }
    ctx.putImageData(img, 0, 0)
    grainUrl = c.toDataURL('image/png')
  } catch {
    grainUrl = ''
  }
  return grainUrl || null
}

let scratch: HTMLCanvasElement | null = null

export interface AmbienceProps {
  /** `recolt://` thumbnail (CORS) to draw the ambience from; `undefined`: colour only. */
  url: string | undefined
  /** Dominant colour (available before any decoding). */
  dominant: string | null
  palette: readonly string[] | null
  /** Post: subdued, desaturated ambience. */
  muted?: boolean
  /** Video playing: the ambience follows the displayed frame. */
  videoRef?: RefObject<HTMLVideoElement | null>
  /** Animations disabled (reduced motion, e2e). */
  still: boolean
  onTint: (tint: ViewerTint) => void
}

export function AmbienceLayer({
  url,
  dominant,
  palette,
  muted = false,
  videoRef,
  still,
  onTint,
}: AmbienceProps) {
  const backRef = useRef<HTMLCanvasElement | null>(null)
  const frontRef = useRef<HTMLCanvasElement | null>(null)
  const lastK = useRef(0.6)
  const loaded = useRef<{ url: string; img: HTMLImageElement } | null>(null)
  const onTintRef = useRef(onTint)
  onTintRef.current = onTint

  const paletteKey = (palette ?? []).join(',')
  const colors = useMemo(
    () =>
      paletteKey
        .split(',')
        .map(parseHex)
        .filter((c): c is Rgb => c !== null),
    [paletteKey],
  )
  const base = parseHex(dominant) ?? colors[0] ?? NEUTRAL
  const baseKey = base.join(',')

  // Immediate tint from the dominant colour, refined once the thumbnail is read.
  useEffect(() => {
    onTintRef.current(tintFrom(base, muted))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey, muted])

  const fallback = useMemo(() => {
    const t = tintFrom(base, muted)
    return `radial-gradient(120% 90% at 30% 25%, ${rgba(t.glow, 0.3)} 0%, ${rgba(t.surface)} 70%)`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey, muted])

  /** Draws the ambience and fades it in above the current one. */
  const present = (source: CanvasImageSource, sw: number, sh: number): AmbienceResult | null => {
    const front = frontRef.current
    const back = backRef.current
    const fctx = front?.getContext('2d')
    const bctx = back?.getContext('2d')
    if (!front || !back || !fctx || !bctx) return null
    scratch ??= document.createElement('canvas')
    const r = drawAmbience(scratch, source, sw, sh, colors, { muted, fallbackK: lastK.current })
    try {
      // Non-CORS source: the scratch canvas is "tainted" (reading impossible).
      scratch.getContext('2d')?.getImageData(0, 0, 1, 1)
    } catch {
      // Start from a fresh canvas next time; the current ambience stays displayed.
      scratch = null
      return null
    }
    // Freeze what is visible (background + top at its current opacity, fade in progress included).
    const alpha = Number(getComputedStyle(front).opacity) || 0
    front.getAnimations().forEach((a) => a.cancel())
    if (alpha > 0) {
      bctx.globalAlpha = alpha
      bctx.drawImage(front, 0, 0)
      bctx.globalAlpha = 1
      back.style.opacity = '1'
    }
    fctx.clearRect(0, 0, AMBIENCE_W, AMBIENCE_H)
    fctx.drawImage(scratch, 0, 0)
    front.style.opacity = '1'
    if (!still) {
      front.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: AMBIENCE_FADE_MS,
        easing: 'ease-in-out',
      })
    }
    return r
  }

  // Thumbnail (and palette halos): CORS load, then draw.
  useEffect(() => {
    let alive = true
    const paint = (img: HTMLImageElement) => {
      if (!alive) return
      const r = present(img, img.naturalWidth, img.naturalHeight)
      if (!r) return
      lastK.current = r.k
      if (r.color) onTintRef.current(tintFrom(r.color, muted))
    }
    if (!url) {
      // No image: colour only.
      const c = Object.assign(document.createElement('canvas'), { width: 4, height: 4 })
      const ctx = c.getContext('2d')
      if (ctx) {
        ctx.fillStyle = rgba(base)
        ctx.fillRect(0, 0, 4, 4)
        present(c, 4, 4)
      }
      return () => {
        alive = false
      }
    }
    if (loaded.current?.url === url) {
      paint(loaded.current.img)
      return () => {
        alive = false
      }
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.src = url
    img
      .decode()
      .then(() => {
        loaded.current = { url, img }
        paint(img)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // `present` reads `colors`, `muted` and `still` from the current render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, paletteKey, muted, baseKey])

  // Video playing: the ambience follows the current frame (tint unchanged).
  useEffect(() => {
    if (!videoRef || still) return
    const id = window.setInterval(() => {
      const v = videoRef.current
      if (!v || v.paused || v.readyState < 2 || document.hidden || !v.isConnected) return
      present(v, v.videoWidth, v.videoHeight)
    }, VIDEO_REFRESH_MS)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, still, url, paletteKey])

  const tile = useMemo(grain, [])

  return (
    <div className="viewer-ambience" aria-hidden="true" style={{ background: fallback }}>
      <canvas
        ref={backRef}
        width={AMBIENCE_W}
        height={AMBIENCE_H}
        className="viewer-ambience-layer"
        style={{ opacity: 0 }}
      />
      <canvas
        ref={frontRef}
        width={AMBIENCE_W}
        height={AMBIENCE_H}
        className="viewer-ambience-layer"
        style={{ opacity: 0 }}
      />
      {tile ? (
        <div className="viewer-ambience-grain" style={{ backgroundImage: `url(${tile})` }} />
      ) : null}
    </div>
  )
}
