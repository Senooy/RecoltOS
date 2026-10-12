/**
 * Ambiance de la vue détail : un champ de couleur flou, plus sombre et plus saturé que le média,
 * tiré de sa vignette (jamais de l'original), et la teinte des surfaces translucides qui en découle.
 *
 * Rendu : la vignette est réduite à 24 × 15 px, puis redessinée floutée et saturée dans un canvas de
 * 96 × 60 px affiché en plein écran (l'agrandissement bilinéaire d'une image déjà floue reste lisse).
 * Deux à trois halos radiaux tirés de la palette donnent de la profondeur, un vignettage assombrit
 * les bords. La luminance est ensuite plafonnée (maximum local et moyenne) : le texte et les icônes
 * blancs restent lisibles quel que soit le média.
 *
 * Teinte : la couleur moyenne (pondérée par la saturation) donne une surface sombre dont la luminance
 * est bornée ; les textes du panneau gardent un contraste AA sur le verre teinté.
 */

export type Rgb = readonly [number, number, number]

/** Résolution du canvas d'ambiance (affiché étiré sur toute la fenêtre). */
export const AMBIENCE_W = 96
export const AMBIENCE_H = 60
/** Échantillon réduit de la vignette. */
const SAMPLE_W = 24
const SAMPLE_H = 15

/** Plafond de luminance relative en tout point de l'ambiance. */
export const AMBIENCE_MAX_LUMINANCE = 0.13
/** Plafond de la luminance moyenne de l'ambiance. */
export const AMBIENCE_MEAN_LUMINANCE = 0.06
/** Plafond de luminance de la surface teintée (panneau, verre). */
export const TINT_MAX_LUMINANCE = 0.028
/** Opacité du verre teinté (panneau, barre de lecture). */
export const GLASS_ALPHA = 0.72
/** Couleur neutre quand le média ne fournit rien (post sans média ni avatar). */
export const NEUTRAL: Rgb = [30, 31, 36]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function parseHex(hex: string | null | undefined): Rgb | null {
  if (!hex) return null
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = Number.parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((v) =>
      Math.round(clamp(v, 0, 255))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

export function rgba(rgb: Rgb, a = 1): string {
  const [r, g, b] = rgb.map((v) => Math.round(clamp(v, 0, 255)))
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`
}

const lin = (c: number) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** Luminance relative WCAG. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Rapport de contraste WCAG. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Mélange `a` sur `b` (composition sRGB, comme le navigateur). */
export function over(a: Rgb, alpha: number, b: Rgb): Rgb {
  return [0, 1, 2].map((i) => a[i]! * alpha + b[i]! * (1 - alpha)) as unknown as Rgb
}

export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0)
  else if (max === G) h = (B - R) / d + 2
  else h = (R - G) / d + 4
  return [h / 6, s, l]
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}

/**
 * Couleur moyenne de pixels RGBA, pondérée par la saturation : les blancs et gris d'une interface
 * pèsent moins que sa couleur dominante.
 */
export function averageColor(data: ArrayLike<number>): Rgb | null {
  let r = 0
  let g = 0
  let b = 0
  let w = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3]! / 255
    if (a === 0) continue
    const R = data[i]!
    const G = data[i + 1]!
    const B = data[i + 2]!
    const max = Math.max(R, G, B)
    const sat = max === 0 ? 0 : (max - Math.min(R, G, B)) / max
    const wt = a * (0.12 + sat)
    r += R * wt
    g += G * wt
    b += B * wt
    w += wt
  }
  return w > 0 ? [r / w, g / w, b / w] : null
}

/** Luminance maximale et moyenne de pixels RGBA. */
export function luminanceStats(data: ArrayLike<number>): { max: number; mean: number } {
  let max = 0
  let sum = 0
  let n = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    const l = luminance([data[i]!, data[i + 1]!, data[i + 2]!])
    if (l > max) max = l
    sum += l
    n++
  }
  return { max, mean: n ? sum / n : 0 }
}

/**
 * Facteur multiplicatif (sur les composantes sRGB) qui ramène l'ambiance sous ses plafonds de
 * luminance. La luminance suit ≈ k^2,2.
 */
export function darkenFactor(stats: { max: number; mean: number }): number {
  const byMax = stats.max > AMBIENCE_MAX_LUMINANCE ? AMBIENCE_MAX_LUMINANCE / stats.max : 1
  const byMean = stats.mean > AMBIENCE_MEAN_LUMINANCE ? AMBIENCE_MEAN_LUMINANCE / stats.mean : 1
  return clamp(Math.min(byMax, byMean) ** (1 / 2.2), 0.05, 1)
}

export interface ViewerTint {
  /** Surface du verre (panneau, lecteur). */
  surface: Rgb
  /** Champs et cartes posés sur le verre. */
  strong: Rgb
  /** Surface opaque (listes de suggestions). */
  solid: Rgb
  /** Halo vif (anneau de focus, survols). */
  glow: Rgb
}

/** Teinte des surfaces à partir de la couleur du média. `muted` : post sans média (sobre). */
export function tintFrom(color: Rgb, muted = false): ViewerTint {
  const [h, s0, l0] = rgbToHsl(color)
  const s = clamp(s0 * (muted ? 0.35 : 1.15), 0, muted ? 0.18 : 0.55)
  let l = 0.085 + 0.07 * l0
  let surface = hslToRgb(h, s, l)
  while (luminance(surface) > TINT_MAX_LUMINANCE && l > 0.03) {
    l -= 0.004
    surface = hslToRgb(h, s, l)
  }
  return {
    surface,
    strong: hslToRgb(h, s * 0.85, Math.min(0.24, l + 0.05)),
    solid: hslToRgb(h, s, l * 0.8),
    glow: hslToRgb(h, Math.min(0.6, s + 0.1), 0.42),
  }
}

/** Variables CSS locales à la vue détail. */
export function tintVars(t: ViewerTint): Record<string, string> {
  return {
    '--viewer-tint': rgba(t.surface, GLASS_ALPHA),
    '--viewer-tint-strong': rgba(t.strong, 0.5),
    '--viewer-tint-solid': rgba(t.solid),
    '--viewer-tint-glow': rgba(t.glow, 0.55),
  }
}

/* ------------------------------------------------------------------ rendu (navigateur) */

let sampleCanvas: HTMLCanvasElement | null = null

function sampleCtx(): CanvasRenderingContext2D | null {
  sampleCanvas ??= Object.assign(document.createElement('canvas'), {
    width: SAMPLE_W,
    height: SAMPLE_H,
  })
  return sampleCanvas.getContext('2d', { willReadFrequently: true })
}

/** Rectangle source pour un recadrage `cover` de `sw × sh` vers `dw × dh`. */
export function coverCrop(
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): [number, number, number, number] {
  const s = Math.max(dw / sw, dh / sh)
  const w = dw / s
  const h = dh / s
  return [(sw - w) / 2, (sh - h) / 2, w, h]
}

function readPixels(ctx: CanvasRenderingContext2D, w: number, h: number): Uint8ClampedArray | null {
  try {
    return ctx.getImageData(0, 0, w, h).data
  } catch {
    // Source non CORS (canvas « tainted ») : l'image reste affichable, pas mesurable.
    return null
  }
}

/** Positions (fractions) et rayons des halos de palette. */
const GLOWS: readonly [number, number, number][] = [
  [0.12, 0.18, 0.75],
  [0.88, 0.9, 0.7],
  [0.7, 0.05, 0.55],
]

export interface AmbienceResult {
  /** Couleur moyenne de la vignette (`null` si illisible). */
  color: Rgb | null
  /** Facteur d'assombrissement appliqué (réutilisable pour une source illisible). */
  k: number
}

/**
 * Dessine l'ambiance de `source` dans `out` (`AMBIENCE_W × AMBIENCE_H`). `palette` : couleurs de
 * l'élément (halos) ; `muted` : désaturation forte (avatar d'un post) ; `fallbackK` : facteur
 * d'assombrissement si la source n'est pas lisible.
 */
export function drawAmbience(
  out: HTMLCanvasElement,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  palette: readonly Rgb[],
  opts: { muted?: boolean; fallbackK?: number } = {},
): AmbienceResult {
  const sctx = sampleCtx()
  const ctx = out.getContext('2d', { willReadFrequently: true })
  if (!sctx || !ctx || sw <= 0 || sh <= 0) return { color: null, k: opts.fallbackK ?? 0.6 }
  out.width = AMBIENCE_W
  out.height = AMBIENCE_H

  sctx.imageSmoothingEnabled = true
  sctx.imageSmoothingQuality = 'high'
  sctx.clearRect(0, 0, SAMPLE_W, SAMPLE_H)
  sctx.drawImage(source, ...coverCrop(sw, sh, SAMPLE_W, SAMPLE_H), 0, 0, SAMPLE_W, SAMPLE_H)
  const sample = readPixels(sctx, SAMPLE_W, SAMPLE_H)
  const color = sample ? averageColor(sample) : null

  const base = color ?? palette[0] ?? NEUTRAL
  ctx.globalCompositeOperation = 'source-over'
  ctx.filter = 'none'
  ctx.fillStyle = rgba(base)
  ctx.fillRect(0, 0, AMBIENCE_W, AMBIENCE_H)
  // Débord : le flou ne fait pas entrer de transparence par les bords.
  const bleed = 14
  ctx.filter = opts.muted ? 'blur(7px) saturate(0.35)' : 'blur(7px) saturate(1.45)'
  ctx.drawImage(sampleCanvas!, -bleed, -bleed, AMBIENCE_W + 2 * bleed, AMBIENCE_H + 2 * bleed)
  ctx.filter = 'none'

  // Halos de la palette (profondeur).
  const glows = palette.slice(1, 1 + GLOWS.length)
  glows.forEach((c, i) => {
    const [fx, fy, fr] = GLOWS[i]!
    const g = ctx.createRadialGradient(
      fx * AMBIENCE_W,
      fy * AMBIENCE_H,
      0,
      fx * AMBIENCE_W,
      fy * AMBIENCE_H,
      fr * AMBIENCE_W,
    )
    const tone = opts.muted ? over(c, 0.3, [128, 128, 128]) : c
    g.addColorStop(0, rgba(tone, 0.26))
    g.addColorStop(1, rgba(tone, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, AMBIENCE_W, AMBIENCE_H)
  })

  // Plafond de luminance (multiplication des composantes).
  const pixels = readPixels(ctx, AMBIENCE_W, AMBIENCE_H)
  const k = pixels ? darkenFactor(luminanceStats(pixels)) : (opts.fallbackK ?? 0.6)
  if (k < 1) {
    ctx.globalCompositeOperation = 'multiply'
    const v = Math.round(k * 255)
    ctx.fillStyle = `rgb(${v}, ${v}, ${v})`
    ctx.fillRect(0, 0, AMBIENCE_W, AMBIENCE_H)
    ctx.globalCompositeOperation = 'source-over'
  }

  // Vignettage et voile haut : n'assombrissent que davantage.
  const vg = ctx.createRadialGradient(
    AMBIENCE_W * 0.42,
    AMBIENCE_H * 0.55,
    AMBIENCE_W * 0.15,
    AMBIENCE_W * 0.42,
    AMBIENCE_H * 0.55,
    AMBIENCE_W * 0.75,
  )
  vg.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vg.addColorStop(1, 'rgba(0, 0, 0, 0.42)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, AMBIENCE_W, AMBIENCE_H)
  const top = ctx.createLinearGradient(0, 0, 0, AMBIENCE_H * 0.4)
  top.addColorStop(0, 'rgba(0, 0, 0, 0.28)')
  top.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = top
  ctx.fillRect(0, 0, AMBIENCE_W, AMBIENCE_H)

  // Échantillon devenu illisible (source non CORS) : un canvas neuf servira la prochaine fois.
  if (!sample) sampleCanvas = null
  return { color, k }
}

/**
 * Couleur du pixel de `el` (image ou vidéo affichée en `cover` dans `box`) sous le point client
 * `(x, y)`, ou `null` (hors média, source non lisible).
 */
let pickCanvas: HTMLCanvasElement | null = null

export function sampleMediaAt(
  el: HTMLImageElement | HTMLVideoElement,
  box: DOMRect,
  x: number,
  y: number,
): string | null {
  const nw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth
  const nh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight
  if (!nw || !nh || box.width <= 0 || box.height <= 0) return null
  const s = Math.max(box.width / nw, box.height / nh)
  const sx = Math.floor((x - box.left - (box.width - nw * s) / 2) / s)
  const sy = Math.floor((y - box.top - (box.height - nh * s) / 2) / s)
  if (sx < 0 || sy < 0 || sx >= nw || sy >= nh) return null
  pickCanvas ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 })
  const ctx = pickCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, 1, 1)
  ctx.drawImage(el, sx, sy, 1, 1, 0, 0, 1, 1)
  const px = readPixels(ctx, 1, 1)
  if (!px || px[3] === 0) return null
  return toHex([px[0]!, px[1]!, px[2]!])
}
