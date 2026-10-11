/**
 * Filtre par couleur (AI §9.2) : ΔE2000 via `differenceCiede2000()` de culori (fabrique ; objets
 * `{mode:'lab65'}`, jamais des tableaux), tolérance 18 par défaut, entrées de poids ≥ 0,05,
 * classement par `d_eff = d − 8·min(1, w/0,30)` (une couleur dominante pèse plus). Pré-filtre ΔE76
 * sur le `Float32Array` (borne large : ΔE76 ≤ 3·tolérance + 10) pour tenir < 2 ms sur 10 000
 * palettes. Plusieurs couleurs : intersection (ET), score = somme.
 *
 * Boucle chaude : `de2000Num` (même formule CIEDE2000, sur nombres, sans objets) — vérifiée égale à
 * culori à 1e-4 près sur les paires de Sharma et 20 000 paires aléatoires (tests) ; le wrapper culori
 * `deltaE2000` reste la référence publique. Raison : culori reconvertit ses arguments à chaque
 * appel (≈ 4 ms pour 10 000 palettes, critère < 2 ms).
 */
import { differenceCiede2000 } from 'culori'
import { hexToLab, type Lab } from '../../shared/color'
import { SLOTS, type PaletteIndex } from './palette-index'

const de2000Fn = differenceCiede2000()

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const P25_7 = 25 ** 7
const COS30 = Math.cos(30 * RAD)
const SIN30 = Math.sin(30 * RAD)
const COS6 = Math.cos(6 * RAD)
const SIN6 = Math.sin(6 * RAD)
const COS63 = Math.cos(63 * RAD)
const SIN63 = Math.sin(63 * RAD)

/**
 * CIEDE2000 (Sharma 2005, kL = kC = kH = 1) sur nombres, sans `atan2` pour les teintes : ΔH' par
 * produits vectoriels, teinte moyenne h̄' par la bissectrice des vecteurs (a', b') unitaires (équivalent
 * à la règle ±360° de Sharma). Δθ (terme de rotation des bleus) n'est calculé que pour h̄' ∈ ]180°, 360°[ :
 * ailleurs il vaut < 2·10⁻⁵°, écart < 10⁻⁴ sur ΔE (tests contre culori).
 */
export function de2000Num(
  l1: number,
  a1: number,
  b1: number,
  l2: number,
  a2: number,
  b2: number,
): number {
  const c1 = Math.sqrt(a1 * a1 + b1 * b1)
  const c2 = Math.sqrt(a2 * a2 + b2 * b2)
  const cm = (c1 + c2) / 2
  const cm2 = cm * cm
  const cm7 = cm2 * cm2 * cm2 * cm
  const g = 0.5 * (1 - Math.sqrt(cm7 / (cm7 + P25_7)))
  const ap1 = (1 + g) * a1
  const ap2 = (1 + g) * a2
  const cp1 = Math.sqrt(ap1 * ap1 + b1 * b1)
  const cp2 = Math.sqrt(ap2 * ap2 + b2 * b2)
  const dL = l2 - l1
  const dC = cp2 - cp1
  const cpm = (cp1 + cp2) / 2
  const prod = cp1 * cp2
  // ΔH' = 2·√(C'1C'2)·sin(Δh'/2) ; |ΔH'|² = 2(C'1C'2 − a'1a'2 − b1b2), signe = produit vectoriel.
  let dH = 0
  let ux = 1
  let uy = 0
  if (prod !== 0) {
    const h2 = Math.max(0, 2 * (prod - ap1 * ap2 - b1 * b2))
    dH = Math.sqrt(h2) * (ap1 * b2 - b1 * ap2 < 0 ? -1 : 1)
    ux = ap1 / cp1 + ap2 / cp2
    uy = b1 / cp1 + b2 / cp2
  } else if (cp1 !== 0) {
    ux = ap1
    uy = b1
  } else if (cp2 !== 0) {
    ux = ap2
    uy = b2
  }
  let n = Math.sqrt(ux * ux + uy * uy)
  if (n === 0) {
    // Teintes opposées (180°) : bissectrice perpendiculaire, côté de Sharma (somme < 360 → +180).
    ux = -b1
    uy = ap1
    n = Math.sqrt(ux * ux + uy * uy) || 1
  }
  const k1 = ux / n
  const q1 = uy / n
  const k2 = 2 * k1 * k1 - 1
  const q2 = 2 * q1 * k1
  const k3 = k1 * (4 * k1 * k1 - 3)
  const q3 = q1 * (3 - 4 * q1 * q1)
  const k4 = 2 * k2 * k2 - 1
  const q4 = 2 * q2 * k2
  const t =
    1 -
    0.17 * (k1 * COS30 + q1 * SIN30) +
    0.24 * k2 +
    0.32 * (k3 * COS6 - q3 * SIN6) -
    0.2 * (k4 * COS63 + q4 * SIN63)
  let rt = 0
  const cpm2 = cpm * cpm
  const cpm7 = cpm2 * cpm2 * cpm2 * cpm
  if (q1 < 0) {
    let hm = Math.atan2(q1, k1) * DEG
    if (hm < 0) hm += 360
    const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2))
    rt = -Math.sin(2 * dTheta * RAD) * 2 * Math.sqrt(cpm7 / (cpm7 + P25_7))
  }
  const lm = (l1 + l2) / 2
  const lm50 = (lm - 50) ** 2
  const sl = 1 + (0.015 * lm50) / Math.sqrt(20 + lm50)
  const sc = 1 + 0.045 * cpm
  const sh = 1 + 0.015 * cpm * t
  const x = dL / sl
  const y = dC / sc
  const z = dH / sh
  return Math.sqrt(x * x + y * y + z * z + rt * y * z)
}

/** ΔE2000 entre deux couleurs Lab D65 (wrapper culori testé sur les paires de Sharma 2005). */
export function deltaE2000(p: Lab, q: Lab): number {
  return de2000Fn(
    { mode: 'lab65', l: p[0], a: p[1], b: p[2] },
    { mode: 'lab65', l: q[0], a: q[1], b: q[2] },
  )
}

export interface ColorQuery {
  lab: Lab
  /** ΔE2000 maximal (défaut 18). */
  tolerance?: number
  /** Poids minimal d'une entrée de palette (défaut 0,05). */
  minWeight?: number
}

export const DEFAULT_TOLERANCE = 18
export const DEFAULT_MIN_WEIGHT = 0.05

export function queryFromHex(hex: string, tolerance?: number): ColorQuery {
  return { lab: hexToLab(hex), ...(tolerance !== undefined ? { tolerance } : {}) }
}

/** Score `d_eff` du meilleur appariement de l'élément `k`, ou `null` s'il ne correspond pas. */
function scoreAt(idx: PaletteIndex, k: number, q: ColorQuery): number | null {
  const tol = q.tolerance ?? DEFAULT_TOLERANCE
  const minW = q.minWeight ?? DEFAULT_MIN_WEIGHT
  const pre = 3 * tol + 10
  const pre2 = pre * pre
  const [tl, ta, tb] = q.lab
  let best: number | null = null
  const c = idx.counts[k]!
  for (let j = 0; j < c; j++) {
    const s = k * SLOTS + j
    const w = idx.w[s]!
    if (w < minW) continue
    const bonus = 8 * Math.min(1, w / 0.3)
    // Cette entrée ne peut pas battre le meilleur score déjà trouvé (d ≥ 0).
    if (best !== null && best <= -bonus) continue
    const o = s * 3
    const l = idx.lab[o]!
    const dl = l - tl
    const da = idx.lab[o + 1]! - ta
    const db = idx.lab[o + 2]! - tb
    if (dl * dl + da * da + db * db > pre2) continue
    // Borne stricte : ΔE2000 ≥ |ΔL| / SL (|RT| < 2).
    const lm50 = ((l + tl) / 2 - 50) ** 2
    if (Math.abs(dl) / (1 + (0.015 * lm50) / Math.sqrt(20 + lm50)) > tol) continue
    const d = de2000Num(l, idx.lab[o + 1]!, idx.lab[o + 2]!, tl, ta, tb)
    if (d > tol) continue
    const eff = d - bonus
    if (best === null || eff < best) best = eff
  }
  return best
}

export interface ColorMatch {
  id: number
  score: number
}

/**
 * Éléments de l'index correspondant à TOUTES les couleurs, triés par score croissant. `among` :
 * restreint aux ids donnés (résultats FTS) ; les ids absents de l'index (sans palette) sont
 * comptés dans `noPalette`.
 */
export function searchColors(
  idx: PaletteIndex,
  queries: readonly ColorQuery[],
  among?: readonly number[],
): { matches: ColorMatch[]; noPalette: number } {
  // Scores dans des tableaux typés (pas d'objet par candidat), objets créés pour les seuls résultats.
  const cap = among ? among.length : idx.n
  const ks = new Int32Array(cap)
  const scores = new Float64Array(idx.n)
  let m = 0
  let noPalette = 0
  const test = (k: number) => {
    let total = 0
    for (let i = 0; i < queries.length; i++) {
      const s = scoreAt(idx, k, queries[i]!)
      if (s === null) return
      total += s
    }
    scores[k] = total
    ks[m++] = k
  }
  if (among) {
    for (const id of among) {
      const k = idx.pos.get(id)
      if (k === undefined) noPalette++
      else test(k)
    }
  } else {
    for (let k = 0; k < idx.n; k++) test(k)
  }
  const order = ks
    .subarray(0, m)
    .sort((x, y) => scores[x]! - scores[y]! || idx.ids[x]! - idx.ids[y]!)
  const matches: ColorMatch[] = new Array<ColorMatch>(m)
  for (let i = 0; i < m; i++) matches[i] = { id: idx.ids[order[i]!]!, score: scores[order[i]!]! }
  return { matches, noPalette }
}
