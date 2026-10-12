/**
 * Palette, dependency-free:
 * 1. sharp → 64×64 max, raw RGBA; pixels with alpha < 128 ignored; Lab conversion (D65).
 * 2. k-means++ (k = 8, seed 42, 12 iterations max).
 * 3. Sort by descending population, merge clusters at ΔE76 < 8, reject those < 1 %.
 * 4. Output in dominance order: `hex` (`labToHex`), `lab` = `hexToLab(hex)` rounded to
 *    4 decimals (consistent with the quantized hex, like imported palettes), `share` (Σ = 1).
 * Deterministic: same file → same palette.
 */
import sharp, { type OutputInfo } from 'sharp'
import { deltaE76, hexToLab, labToHex, rgbToLab, type Lab } from '../../../shared/color'
import { AppError } from '../../../shared/errors'
import type { MediaResult } from '../../../shared/worker-protocol'
import { assertAbs, rawError, type MediaTools } from './exec'
import { withReadable } from './foreign'

export const PALETTE = {
  k: 8,
  seed: 42,
  maxIter: 12,
  sample: 64,
  alphaMin: 128,
  mergeDeltaE: 8,
  minShare: 0.01,
} as const

/** PRNG mulberry32: reproducible, independent of `Math.random`. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Cluster {
  lab: [number, number, number]
  count: number
}

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0 // `+ 0`: no -0

function dist2(p: Float64Array, i: number, c: readonly number[]): number {
  const dl = (p[i * 3] ?? 0) - (c[0] ?? 0)
  const da = (p[i * 3 + 1] ?? 0) - (c[1] ?? 0)
  const db = (p[i * 3 + 2] ?? 0) - (c[2] ?? 0)
  return dl * dl + da * da + db * db
}

/**
 * k-means++ on Lab points (`points` = [L,a,b]×n). Returns the non-empty clusters,
 * sorted by descending population (ties: L, a, b ascending, for stability).
 */
export function kmeansLab(
  points: Float64Array,
  k: number,
  seed: number = PALETTE.seed,
  maxIter: number = PALETTE.maxIter,
): Cluster[] {
  const n = Math.floor(points.length / 3)
  if (n === 0 || k <= 0) return []
  const rand = mulberry32(seed)
  const centers: number[][] = []
  const at = (i: number): number[] => [
    points[i * 3] ?? 0,
    points[i * 3 + 1] ?? 0,
    points[i * 3 + 2] ?? 0,
  ]
  centers.push(at(Math.min(n - 1, Math.floor(rand() * n))))
  const d2 = new Float64Array(n)
  for (let i = 0; i < n; i++) d2[i] = dist2(points, i, centers[0] ?? [])
  while (centers.length < k) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += d2[i] ?? 0
    if (sum <= 1e-12) break // fewer distinct colors than k
    let r = rand() * sum
    let pick = n - 1
    for (let i = 0; i < n; i++) {
      r -= d2[i] ?? 0
      if (r <= 0) {
        pick = i
        break
      }
    }
    const c = at(pick)
    centers.push(c)
    for (let i = 0; i < n; i++) {
      const d = dist2(points, i, c)
      if (d < (d2[i] ?? 0)) d2[i] = d
    }
  }
  const kk = centers.length
  const assign = new Int32Array(n).fill(-1)
  const counts = new Float64Array(kk)
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false
    for (let i = 0; i < n; i++) {
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < kk; c++) {
        const d = dist2(points, i, centers[c] ?? [])
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      if (assign[i] !== best) {
        assign[i] = best
        changed = true
      }
    }
    const sums = new Float64Array(kk * 3)
    counts.fill(0)
    for (let i = 0; i < n; i++) {
      const c = assign[i] ?? 0
      counts[c] = (counts[c] ?? 0) + 1
      sums[c * 3] = (sums[c * 3] ?? 0) + (points[i * 3] ?? 0)
      sums[c * 3 + 1] = (sums[c * 3 + 1] ?? 0) + (points[i * 3 + 1] ?? 0)
      sums[c * 3 + 2] = (sums[c * 3 + 2] ?? 0) + (points[i * 3 + 2] ?? 0)
    }
    for (let c = 0; c < kk; c++) {
      const m = counts[c] ?? 0
      // Empty cluster: the centre stays in place (it will be dropped at output).
      if (m > 0)
        centers[c] = [
          (sums[c * 3] ?? 0) / m,
          (sums[c * 3 + 1] ?? 0) / m,
          (sums[c * 3 + 2] ?? 0) / m,
        ]
    }
    if (!changed && iter > 0) break
  }
  const out: Cluster[] = []
  for (let c = 0; c < kk; c++) {
    const m = counts[c] ?? 0
    const ctr = centers[c]
    if (m > 0 && ctr) out.push({ lab: [ctr[0] ?? 0, ctr[1] ?? 0, ctr[2] ?? 0], count: m })
  }
  return sortClusters(out)
}

function sortClusters(cs: Cluster[]): Cluster[] {
  return cs.sort(
    (x, y) =>
      y.count - x.count || x.lab[0] - y.lab[0] || x.lab[1] - y.lab[1] || x.lab[2] - y.lab[2],
  )
}

/** Merge ΔE76 < threshold (in dominance order), then reject clusters < `minShare`. */
export function mergeClusters(
  sorted: readonly Cluster[],
  mergeDeltaE: number = PALETTE.mergeDeltaE,
  minShare: number = PALETTE.minShare,
): Cluster[] {
  const kept: Cluster[] = []
  for (const c of sorted) {
    const host = kept.find((k) => deltaE76(k.lab, c.lab) < mergeDeltaE)
    if (host) {
      const total = host.count + c.count
      host.lab = [
        (host.lab[0] * host.count + c.lab[0] * c.count) / total,
        (host.lab[1] * host.count + c.lab[1] * c.count) / total,
        (host.lab[2] * host.count + c.lab[2] * c.count) / total,
      ]
      host.count = total
    } else {
      kept.push({ lab: [...c.lab], count: c.count })
    }
  }
  const total = kept.reduce((s, c) => s + c.count, 0)
  const big = kept.filter((c) => c.count / total >= minShare)
  return sortClusters(big.length > 0 ? big : kept.slice(0, 1))
}

/** Palette from clusters: hex, Lab consistent with the hex, normalized shares. */
export function toPalette(clusters: readonly Cluster[]): MediaResult<'palette'> {
  const total = clusters.reduce((s, c) => s + c.count, 0)
  const hex: string[] = []
  const lab: [number, number, number][] = []
  const share: number[] = []
  for (const c of clusters) {
    const h = labToHex(c.lab)
    if (hex.includes(h)) {
      // Two clusters quantized to the same hex: their shares are summed.
      const i = hex.indexOf(h)
      share[i] = (share[i] ?? 0) + c.count / total
      continue
    }
    const l: Lab = hexToLab(h)
    hex.push(h)
    lab.push([round4(l[0]), round4(l[1]), round4(l[2])])
    share.push(c.count / total)
  }
  return { hex, lab, share: share.map(round4) }
}

/** Palette of an RGBA array (exported for tests). */
export function paletteFromRgba(
  data: Uint8Array,
  channels: number,
  k: number = PALETTE.k,
): MediaResult<'palette'> {
  const n = Math.floor(data.length / channels)
  const pts = new Float64Array(n * 3)
  let m = 0
  for (let i = 0; i < n; i++) {
    const o = i * channels
    const alpha = channels >= 4 ? (data[o + 3] ?? 255) : 255
    if (alpha < PALETTE.alphaMin) continue
    const l = rgbToLab([data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0])
    pts[m * 3] = l[0]
    pts[m * 3 + 1] = l[1]
    pts[m * 3 + 2] = l[2]
    m++
  }
  if (m === 0) return { hex: [], lab: [], share: [] }
  const clusters = kmeansLab(pts.subarray(0, m * 3), k)
  return toPalette(mergeClusters(clusters))
}

export async function palette(
  a: { src: string; k?: 8 },
  tools: MediaTools,
  signal?: AbortSignal,
): Promise<MediaResult<'palette'>> {
  const src = assertAbs(a.src, 'src')
  const k = a.k ?? PALETTE.k
  if (k !== PALETTE.k) throw new AppError('validation', 'k must be 8')
  return withReadable(src, tools, signal, async ({ input }) => {
    let raw: { data: Buffer; info: OutputInfo }
    try {
      raw = await sharp(input, { animated: false })
        .rotate()
        .resize(PALETTE.sample, PALETTE.sample, { fit: 'inside' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
    } catch (err) {
      throw new AppError('decode_failed', 'unreadable image', rawError(err))
    }
    return paletteFromRgba(raw.data, raw.info.channels, k)
  })
}
