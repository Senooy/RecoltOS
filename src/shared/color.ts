/**
 * CIELAB D65 colour conversions. No dependencies.
 */

export type Rgb = readonly [number, number, number]
export type Lab = readonly [number, number, number]
export type Lch = readonly [number, number, number]

/** Chroma threshold below which a colour is "neutral" (bucket 12). */
export const NEUTRAL_CHROMA = 12
/** "Unknown" bucket (no palette), sorted last. */
export const UNKNOWN_BUCKET = 13
export const NEUTRAL_BUCKET = 12

const XN = 0.95047
const YN = 1
const ZN = 1.08883
const EPS = (6 / 29) ** 3
const KAPPA = 3 * (6 / 29) ** 2

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m?.[1]) throw new Error(`couleur hex invalide : ${hex}`)
  const n = Number.parseInt(m[1], 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

const toLinear = (c: number): number => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const fromLinear = (v: number): number => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  return c * 255
}
const f = (t: number): number => (t > EPS ? Math.cbrt(t) : t / KAPPA + 4 / 29)
const fInv = (t: number): number => (t > 6 / 29 ? t ** 3 : KAPPA * (t - 4 / 29))

export function rgbToLab([r8, g8, b8]: Rgb): Lab {
  const r = toLinear(r8)
  const g = toLinear(g8)
  const b = toLinear(b8)
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b
  const fx = f(x / XN)
  const fy = f(y / YN)
  const fz = f(z / ZN)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function labToRgb([l, a, bb]: Lab): Rgb {
  const fy = (l + 16) / 116
  const fx = fy + a / 500
  const fz = fy - bb / 200
  const x = XN * fInv(fx)
  const y = YN * fInv(fy)
  const z = ZN * fInv(fz)
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z
  const b = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z
  return [fromLinear(r), fromLinear(g), fromLinear(b)]
}

export const hexToLab = (hex: string): Lab => rgbToLab(hexToRgb(hex))
export const labToHex = (lab: Lab): string => rgbToHex(labToRgb(lab))

/** LCh: C = chroma, H = hue in degrees [0, 360). */
export function labToLch([l, a, b]: Lab): Lch {
  const c = Math.hypot(a, b)
  let h = (Math.atan2(b, a) * 180) / Math.PI
  if (h < 0) h += 360
  return [l, c, h]
}

/** ΔE76 (Euclidean distance in Lab): k-means merging. The filter uses ΔE2000. */
export function deltaE76(p: Lab, q: Lab): number {
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

/** Hue sector offset: reds (≈ 350–20°) are no longer split in two. */
export const HUE_OFFSET = 15

/**
 * Colour sort bucket: 0..11 hue by 30° sectors offset by 15° (0 = reds from 345° to 15°,
 * 1 = red-orange…), 12 neutral (C < 12), 13 unknown. Migration `0002` recomputes existing values.
 */
export function hueBucket(lch: Lch | null | undefined): number {
  if (!lch) return UNKNOWN_BUCKET
  const [, c, h] = lch
  if (!Number.isFinite(c) || !Number.isFinite(h)) return UNKNOWN_BUCKET
  if (c < NEUTRAL_CHROMA) return NEUTRAL_BUCKET
  return Math.floor(((((h + HUE_OFFSET) % 360) + 360) % 360) / 30) % 12
}

export interface NamedColor {
  id: string
  /** French label (filter chips). */
  label: string
  hex: string
  /** Constant Lab D65 centre (derived from `hex`). */
  lab: Lab
}

const named = (id: string, label: string, hex: string): NamedColor => ({
  id,
  label,
  hex,
  lab: hexToLab(hex),
})

/** 12 named filter colours, from red to pink, then neutrals. */
export const NAMED_COLORS: readonly NamedColor[] = [
  named('rouge', 'Rouge', '#e0312b'),
  named('orange', 'Orange', '#f2862a'),
  named('jaune', 'Jaune', '#f4d02c'),
  named('vert', 'Vert', '#3fa34d'),
  named('turquoise', 'Turquoise', '#2bbfb3'),
  named('bleu', 'Bleu', '#2f6be0'),
  named('violet', 'Violet', '#7a4fd4'),
  named('rose', 'Rose', '#ec5fa6'),
  named('marron', 'Marron', '#7b4a2b'),
  named('noir', 'Noir', '#151515'),
  named('gris', 'Gris', '#8c8c8c'),
  named('blanc', 'Blanc', '#f4f4f4'),
]

/** Default tolerance of the colour filter (ΔE2000). */
export const DEFAULT_COLOR_TOLERANCE = 18
