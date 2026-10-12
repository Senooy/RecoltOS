import { describe, expect, it } from 'vitest'
import { listItems } from '../../../src/main/db/queries/list'
import { hexToLab, hueBucket, labToLch } from '../../../src/shared/color'
import { openTestDb } from '../../helpers/db'

function insert(db: ReturnType<typeof openTestDb>, id: number, hex: string | null) {
  const lab = hex ? hexToLab(hex) : null
  const lch = lab ? labToLch(lab) : null
  db.prepare(
    `INSERT INTO items(id, uuid, kind, created_at, updated_at, palette, palette_lab,
                       color_l, color_c, color_h, color_bucket)
     VALUES (?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    id,
    id,
    hex ? JSON.stringify([hex]) : null,
    lab ? JSON.stringify([lab]) : null,
    lch?.[0] ?? null,
    lch?.[1] ?? null,
    lch?.[2] ?? null,
    hueBucket(lch),
  )
}

describe('color sort', () => {
  it('items without a palette (bucket 13) at the end, reds grouped, neutrals from light to dark', () => {
    const db = openTestDb()
    const hexes = ['#2f6be0', '#e0312b', '#ff3a6e', '#f4d02c', '#ffffff', '#202020', '#3fa34d']
    hexes.forEach((h, i) => insert(db, i + 1, h))
    for (let i = 0; i < 5; i++) insert(db, 100 + i, null)
    const r = listItems(db, {
      scope: 'library',
      tab: 'all',
      sort: 'color',
      cursor: null,
      limit: 100,
    })
    const ids = r.rows.map((x) => Number(x.uuid.slice(-12)))
    expect(ids.slice(-5).sort()).toEqual([100, 101, 102, 103, 104])
    // White precedes black (neutrals from light to dark), after the hues.
    expect(ids.indexOf(5)).toBeLessThan(ids.indexOf(6))
    expect(ids.indexOf(5)).toBeGreaterThan(ids.indexOf(1))
    db.close()
  })
})

describe('migration 0002 (buckets shifted by 15°)', () => {
  it('recomputes the hue buckets, leaves neutrals and unknowns alone', () => {
    const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    const mem = openTestDb({ upTo: 1 })
    mem.exec(`INSERT INTO items(id, uuid, kind, created_at, updated_at, color_l, color_c, color_h, color_bucket)
      VALUES (1,'${u(1)}','image',1,1,50,40,350,11),(2,'${u(2)}','image',1,1,50,40,10,0),
             (3,'${u(3)}','image',1,1,50,40,20,0),(4,'${u(4)}','image',1,1,50,40,344.5,11),
             (5,'${u(5)}','image',1,1,50,5,200,12),(6,'${u(6)}','image',1,1,50,NULL,NULL,13)`)
    const sql = Object.values(
      import.meta.glob<string>('../../../src/main/db/migrations/0002_*.sql', {
        query: '?raw',
        import: 'default',
        eager: true,
      }),
    )[0]!
    mem.exec(sql)
    const rows = mem.prepare('SELECT id, color_bucket b FROM items ORDER BY id').all()
    expect(rows).toEqual([
      { id: 1, b: 0 },
      { id: 2, b: 0 },
      { id: 3, b: 1 },
      { id: 4, b: 11 },
      { id: 5, b: 12 },
      { id: 6, b: 13 },
    ])
    for (const r of rows as { id: number; b: number }[]) {
      if (r.id <= 4) {
        const h = [350, 10, 20, 344.5][r.id - 1]!
        expect(hueBucket([50, 40, h])).toBe(r.b)
      }
    }
    mem.close()
  })
})
