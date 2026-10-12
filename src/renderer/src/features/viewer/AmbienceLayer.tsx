/**
 * Calque d'ambiance de la vue détail (dans `.viewer-backdrop`, dont il suit les fondus d'ouverture
 * et de fermeture). L'ambiance est dessinée dans un canvas hors écran de 96 × 60 px puis affichée en
 * image de fond étirée sur deux calques superposés : la nouvelle apparaît en fondu (450 ms ;
 * instantané en mouvement réduit) au-dessus de l'ancienne. Hors fondu, ce sont de simples fonds
 * peints, sans calque GPU dédié. Avant le premier dessin, un dégradé tiré de la couleur dominante
 * de la carte occupe le fond. Vidéo en lecture : l'ambiance suit l'image courante toutes les 2 s.
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import {
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

/** Grain très léger, en tuile (évite les bandes des dégradés sombres agrandis). */
function grain(): string | null {
  if (grainUrl !== null) return grainUrl || null
  try {
    const c = Object.assign(document.createElement('canvas'), { width: 96, height: 96 })
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('2d')
    const img = ctx.createImageData(96, 96)
    // Pseudo-aléatoire à graine fixe : le grain est identique d'une ouverture à l'autre.
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
  /** Vignette `recolt://` (CORS) d'où tirer l'ambiance ; `undefined` : couleur seule. */
  url: string | undefined
  /** Couleur dominante (disponible avant tout décodage). */
  dominant: string | null
  palette: readonly string[] | null
  /** Post : ambiance sobre, désaturée. */
  muted?: boolean
  /** Vidéo en cours : l'ambiance suit l'image affichée. */
  videoRef?: RefObject<HTMLVideoElement | null>
  /** Animations coupées (mouvement réduit, e2e). */
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
  const layers = useRef<(HTMLDivElement | null)[]>([null, null])
  const front = useRef(-1)
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

  // Teinte immédiate depuis la couleur dominante, affinée une fois la vignette lue.
  useEffect(() => {
    onTintRef.current(tintFrom(base, muted))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey, muted])

  const fallback = useMemo(() => {
    const t = tintFrom(base, muted)
    return `radial-gradient(120% 90% at 30% 25%, ${rgba(t.glow, 0.3)} 0%, ${rgba(t.surface)} 70%)`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey, muted])

  /** Dessine l'ambiance et la fait apparaître au-dessus de l'actuelle. */
  const present = (source: CanvasImageSource, sw: number, sh: number): AmbienceResult | null => {
    const next = front.current === 0 ? 1 : 0
    const el = layers.current[next]
    const prev = front.current >= 0 ? layers.current[front.current] : null
    if (!el) return null
    scratch ??= document.createElement('canvas')
    const r = drawAmbience(scratch, source, sw, sh, colors, { muted, fallbackK: lastK.current })
    let data: string
    try {
      data = scratch.toDataURL('image/png')
    } catch {
      // Canvas non lisible (source non CORS) : on repart d'un canvas neuf la prochaine fois.
      scratch = null
      return null
    }
    front.current = next
    el.getAnimations().forEach((a) => a.cancel())
    el.style.backgroundImage = `url(${data})`
    el.style.zIndex = '2'
    el.style.opacity = '1'
    if (prev) prev.style.zIndex = '1'
    if (still) {
      if (prev) prev.style.opacity = '0'
      return r
    }
    const anim = el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: AMBIENCE_FADE_MS,
      easing: 'ease-in-out',
    })
    anim.onfinish = () => {
      if (prev && front.current === next) prev.style.opacity = '0'
    }
    return r
  }

  // Vignette (et halos de palette) : chargement CORS puis dessin.
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
      // Pas d'image : uniquement la couleur.
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
    // `present` lit `colors`, `muted` et `still` du rendu courant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, paletteKey, muted, baseKey])

  // Vidéo en lecture : l'ambiance suit l'image courante (teinte inchangée).
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
      <div
        ref={(el) => {
          layers.current[0] = el
        }}
        className="viewer-ambience-layer"
        style={{ opacity: 0 }}
      />
      <div
        ref={(el) => {
          layers.current[1] = el
        }}
        className="viewer-ambience-layer"
        style={{ opacity: 0 }}
      />
      {tile ? (
        <div className="viewer-ambience-grain" style={{ backgroundImage: `url(${tile})` }} />
      ) : null}
    </div>
  )
}
