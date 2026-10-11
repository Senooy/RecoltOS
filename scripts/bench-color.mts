/**
 * `pnpm run bench:color` (WP-31) : filtre « rouge » sur 10 000 palettes synthétiques de 8 couleurs
 * (pire cas : couleurs uniformes) ; échoue si la médiane dépasse 2 ms.
 */
import Database from 'better-sqlite3'
import { queryFromHex, searchColors } from '../src/main/color/color-search'
import { buildPaletteIndex } from '../src/main/color/palette-index'
import { NAMED_COLORS, hexToLab, rgbToHex } from '../src/shared/color'

const db = new Database(':memory:')
db.exec(
  'CREATE TABLE items(id INTEGER PRIMARY KEY, palette TEXT, palette_lab TEXT, palette_weights TEXT)',
)
let seed = 7
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const ins = db.prepare('INSERT INTO items(id, palette_lab) VALUES (?, ?)')
db.transaction(() => {
  for (let i = 1; i <= 10_000; i++) {
    const labs = Array.from({ length: 8 }, () =>
      hexToLab(rgbToHex([rnd() * 255, rnd() * 255, rnd() * 255])),
    )
    ins.run(i, JSON.stringify(labs))
  }
})()
const idx = buildPaletteIndex(db)
const q = [queryFromHex(NAMED_COLORS[0]!.hex)]
for (let i = 0; i < 40; i++) searchColors(idx, q)
const times: number[] = []
let matches = 0
for (let i = 0; i < 51; i++) {
  const t0 = performance.now()
  matches = searchColors(idx, q).matches.length
  times.push(performance.now() - t0)
}
times.sort((a, b) => a - b)
const median = times[25]!
console.log(
  `bench:color : ${idx.n} palettes, ${matches} correspondances « rouge », médiane ${median.toFixed(2)} ms (min ${times[0]!.toFixed(2)})`,
)
process.exitCode = median < 2 ? 0 : 1
