/**
 * `PaletteIndex` (ARCHI §8, AI §9.2) : palettes de la bibliothèque en mémoire — `Float32Array`
 * n × 8 × 3 (Lab D65) + poids n × 8 (`palette_weights`, sinon pondération par le rang) + objets
 * `{mode:'lab65'}` pour culori, créés une fois. Reconstruit paresseusement après `items.changed`
 * (`invalidatePaletteIndex`, appelé par `events.ts`). Une base = un index.
 */
import type Database from 'better-sqlite3'
import { hexToLab } from '../../shared/color'

export const SLOTS = 8

/** Poids par rang quand `palette_weights` est NULL (somme = 1). */
export const RANK_WEIGHTS = [0.3, 0.2, 0.15, 0.11, 0.09, 0.07, 0.05, 0.03] as const

export interface LabObj {
  mode: 'lab65'
  l: number
  a: number
  b: number
}

export interface PaletteIndex {
  /** Nombre d'éléments indexés. */
  n: number
  ids: Int32Array
  /** Position de chaque id dans l'index. */
  pos: Map<number, number>
  /** Nombre de couleurs par élément (≤ 8). */
  counts: Uint8Array
  lab: Float32Array
  w: Float32Array
  objs: LabObj[]
}

interface Row {
  id: number
  palette: string | null
  palette_lab: string | null
  palette_weights: string | null
}

function parseNumArray(raw: string | null): unknown[] | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? (v as unknown[]) : null
  } catch {
    return null
  }
}

export function buildPaletteIndex(db: Database.Database): PaletteIndex {
  const rows = db
    .prepare(
      `SELECT id, palette, palette_lab, palette_weights FROM items
       WHERE palette_lab IS NOT NULL OR palette IS NOT NULL ORDER BY id`,
    )
    .all() as Row[]
  const n = rows.length
  const ids = new Int32Array(n)
  const counts = new Uint8Array(n)
  const lab = new Float32Array(n * SLOTS * 3)
  const w = new Float32Array(n * SLOTS)
  const objs: LabObj[] = new Array<LabObj>(n * SLOTS)
  const pos = new Map<number, number>()
  let k = 0
  for (const r of rows) {
    // `palette_lab` (importé ou calculé) ; à défaut, conversion des hex de `palette`.
    let labs = parseNumArray(r.palette_lab)
    if (!labs || labs.length === 0) {
      labs = (parseNumArray(r.palette) ?? [])
        .filter((h): h is string => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h))
        .map((h) => [...hexToLab(h)])
    }
    if (labs.length === 0) continue
    const weights = parseNumArray(r.palette_weights)
    let c = 0
    let sum = 0
    for (let j = 0; j < labs.length && c < SLOTS; j++) {
      const e = labs[j]
      if (!Array.isArray(e) || e.length < 3) continue
      const [l, a, b] = e as number[]
      if (![l, a, b].every((x) => typeof x === 'number' && Number.isFinite(x))) continue
      const o = (k * SLOTS + c) * 3
      lab[o] = l!
      lab[o + 1] = a!
      lab[o + 2] = b!
      objs[k * SLOTS + c] = { mode: 'lab65', l: l!, a: a!, b: b! }
      const wj =
        weights && typeof weights[j] === 'number' ? (weights[j] as number) : RANK_WEIGHTS[c]!
      w[k * SLOTS + c] = wj
      sum += wj
      c++
    }
    if (c === 0) continue
    if (sum > 0) for (let j = 0; j < c; j++) w[k * SLOTS + j]! /= sum
    ids[k] = r.id
    counts[k] = c
    pos.set(r.id, k)
    k++
  }
  return { n: k, ids: ids.subarray(0, k), pos, counts, lab, w, objs }
}

const cache = new WeakMap<Database.Database, PaletteIndex>()

export function getPaletteIndex(db: Database.Database): PaletteIndex {
  let idx = cache.get(db)
  if (!idx) {
    idx = buildPaletteIndex(db)
    cache.set(db, idx)
  }
  return idx
}

export function invalidatePaletteIndex(db: Database.Database): void {
  cache.delete(db)
}
