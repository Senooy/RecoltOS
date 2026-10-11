import { converter } from 'culori'
import { describe, expect, it } from 'vitest'
import {
  NAMED_COLORS,
  NEUTRAL_BUCKET,
  hexToLab,
  hueBucket,
  labToLch,
  rgbToHex,
  type Lab,
} from '../../../src/shared/color'
import { namedColorHex } from '../../../src/shared/search-query'
import {
  de2000Num,
  deltaE2000,
  queryFromHex,
  searchColors,
} from '../../../src/main/color/color-search'
import {
  buildPaletteIndex,
  getPaletteIndex,
  invalidatePaletteIndex,
} from '../../../src/main/color/palette-index'
import { openTestDb } from '../../helpers/db'

/** Sharma, Wu et Dalal (2005), table 1 : paires de contrôle et ΔE00 attendu. */
const SHARMA: [Lab, Lab, number][] = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
  [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, -1, 2], [50, 0, 0], 2.3669],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[50, 2.5, 0], [61, -5, 29], 22.8977],
  [[50, 2.5, 0], [56, -27, -3], 31.903],
  [[50, 2.5, 0], [58, 24, 15], 19.4535],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
  [[61.2901, 3.7196, -5.3901], [61.4292, 2.248, -4.962], 1.8731],
  [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
  [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
  [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
  [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
]

describe('ΔE2000 (wrapper culori)', () => {
  it.each(SHARMA)('paire de Sharma %#', (a, b, expected) => {
    expect(deltaE2000(a, b)).toBeCloseTo(expected, 3)
  })
})

describe('ΔE2000 numérique de la boucle chaude', () => {
  it('égal au wrapper culori à 1e-4 (Sharma + 20 000 paires aléatoires)', () => {
    for (const [a, b] of SHARMA)
      expect(Math.abs(de2000Num(...a, ...b) - deltaE2000(a, b))).toBeLessThan(1e-4)
    let s = 1
    const r = (k: number) => {
      s = (s * 16807) % 2147483647
      return (s / 2147483647) * k
    }
    for (let i = 0; i < 20_000; i++) {
      const a: Lab = [r(100), r(256) - 128, r(256) - 128]
      const b: Lab = [r(100), r(256) - 128, r(256) - 128]
      expect(Math.abs(de2000Num(...a, ...b) - deltaE2000(a, b))).toBeLessThan(1e-4)
    }
  })
})

describe('Lab D65 maison', () => {
  it('#1850f0 ≈ [41.5641, 44.0679, -84.0211] (palette_lab la référence)', () => {
    const [l, a, b] = hexToLab('#1850f0')
    expect(l).toBeCloseTo(41.5641, 3)
    expect(a).toBeCloseTo(44.0679, 3)
    expect(b).toBeCloseTo(-84.0211, 3)
  })
  it('conforme à culori `lab65` à 0,05 près', () => {
    const toLab = converter('lab65')
    for (let i = 0; i < 400; i++) {
      const rgb = [(i * 37) % 256, (i * 91) % 256, (i * 151) % 256] as const
      const hex = rgbToHex(rgb)
      const mine = hexToLab(hex)
      const ref = toLab(hex)!
      expect(Math.abs(mine[0] - ref.l)).toBeLessThan(0.05)
      expect(Math.abs(mine[1] - ref.a)).toBeLessThan(0.05)
      expect(Math.abs(mine[2] - ref.b)).toBeLessThan(0.05)
    }
  })
})

describe('buckets de teinte décalés de 15°', () => {
  const lch = (h: number) => [60, 40, h] as const
  it('les rouges ne sont plus coupés en deux', () => {
    expect(hueBucket(lch(350))).toBe(0)
    expect(hueBucket(lch(5))).toBe(0)
    expect(hueBucket(lch(14.9))).toBe(0)
    expect(hueBucket(lch(15))).toBe(1)
    expect(hueBucket(lch(344.9))).toBe(11)
    expect(hueBucket([60, 5, 120])).toBe(NEUTRAL_BUCKET)
  })
  it('les 12 couleurs nommées : 8 teintes ordonnées puis neutres', () => {
    const buckets = NAMED_COLORS.map((c) => hueBucket(labToLch(c.lab)))
    expect(buckets[0]).toBeLessThanOrEqual(1)
    for (const b of buckets.slice(0, 9)) expect(b).toBeLessThan(NEUTRAL_BUCKET)
    expect(buckets.slice(9)).toEqual([NEUTRAL_BUCKET, NEUTRAL_BUCKET, NEUTRAL_BUCKET])
    expect(namedColorHex('Rouge')).toBe('#e0312b')
    expect(namedColorHex('inconnue')).toBeNull()
  })
})

function insert(
  db: ReturnType<typeof openTestDb>,
  id: number,
  hexes: string[] | null,
  weights?: number[],
) {
  db.prepare(
    `INSERT INTO items(id, uuid, kind, created_at, updated_at, palette, palette_lab, palette_weights)
     VALUES (?, ?, 'image', ?, ?, ?, ?, ?)`,
  ).run(
    id,
    `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    id,
    id,
    hexes ? JSON.stringify(hexes) : null,
    hexes ? JSON.stringify(hexes.map((h) => hexToLab(h))) : null,
    weights ? JSON.stringify(weights) : null,
  )
}

describe('PaletteIndex + filtre', () => {
  it('« rouge » renvoie les éléments dominés par le rouge, poids et intersection', () => {
    const db = openTestDb()
    insert(db, 1, ['#d0201c', '#ffffff'])
    insert(db, 2, ['#1a3fd0', '#f2f2f2'])
    insert(db, 3, ['#ffffff', '#202020', '#c81e1e'], [0.6, 0.38, 0.02])
    insert(db, 4, ['#f2f2f2', '#c42222'])
    insert(db, 5, null)
    const idx = buildPaletteIndex(db)
    expect(idx.n).toBe(4)
    const red = searchColors(idx, [queryFromHex(NAMED_COLORS[0]!.hex)], [1, 2, 3, 4, 5])
    expect(red.matches.map((m) => m.id)).toEqual([1, 4])
    expect(red.noPalette).toBe(1)
    const both = searchColors(idx, [queryFromHex('#e0312b'), queryFromHex('#ffffff')])
    expect(both.matches.map((m) => m.id)).toEqual([1, 4])
    const blue = searchColors(idx, [queryFromHex('#2f6be0', 25)])
    expect(blue.matches.map((m) => m.id)).toEqual([2])
    db.close()
  })

  it('index paresseux invalidé', () => {
    const db = openTestDb()
    insert(db, 1, ['#d0201c'])
    const a = getPaletteIndex(db)
    expect(getPaletteIndex(db)).toBe(a)
    insert(db, 2, ['#1a3fd0'])
    invalidatePaletteIndex(db)
    expect(getPaletteIndex(db).n).toBe(2)
    db.close()
  })

  it('10 000 palettes : garde-fou de performance', () => {
    const db = openTestDb()
    let seed = 7
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    db.transaction(() => {
      for (let i = 1; i <= 10_000; i++) {
        const hexes = Array.from({ length: 8 }, () =>
          rgbToHex([rnd() * 255, rnd() * 255, rnd() * 255]),
        )
        insert(db, i, hexes)
      }
    })()
    const idx = buildPaletteIndex(db)
    const q = [queryFromHex(NAMED_COLORS[0]!.hex)]
    for (let i = 0; i < 40; i++) searchColors(idx, q)
    const times: number[] = []
    for (let i = 0; i < 21; i++) {
      const t0 = performance.now()
      searchColors(idx, q)
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    // Garde-fou sous la charge de la suite parallèle ; le critère strict (médiane < 2 ms) est
    // mesuré seul par `pnpm run bench:color` (≈ 1,1 ms).
    expect(times[0]!).toBeLessThan(5)
    db.close()
  })
})
