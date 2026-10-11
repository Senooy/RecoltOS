import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  blend,
  layoutScore,
  makeMontage,
  maskRect,
  prepare,
  toRaw,
} from '../../scripts/visual/compare.mjs'
import { ALL_SCENES, START_SCENES, selectScenes } from '../../scripts/visual/scenes.mjs'
import { refsFor, loadRefMap } from '../../scripts/visual/refs.mjs'
import { makeTmpDir } from './tmpdir'

const solid = (w: number, h: number, color: string) =>
  toRaw(sharp({ create: { width: w, height: h, channels: 3, background: color } }))

describe('compare', () => {
  it('images identiques : 0 pixel différent, disposition 0 ; images opposées : écart net', async () => {
    const a = await solid(64, 40, '#ffffff')
    const same = await makeMontage(a, await solid(64, 40, '#ffffff'))
    expect(same.mismatched).toBe(0)
    expect(await layoutScore(a, await solid(64, 40, '#ffffff'))).toBe(0)
    const black = await solid(64, 40, '#000000')
    expect((await makeMontage(a, black)).ratio).toBe(1)
    expect(await layoutScore(a, black)).toBeGreaterThan(0.9)
  })

  it('montage = [réf | RecoltOS | fondu] : 3 largeurs + gouttières', async () => {
    const m = await makeMontage(await solid(50, 30, '#ffffff'), await solid(50, 30, '#000000'))
    const meta = await sharp(m.montage).metadata()
    expect([meta.width, meta.height]).toEqual([158, 30])
  })

  it('fondu 50 % et masque des feux tricolores', async () => {
    const mix = blend(await solid(2, 2, '#000000'), await solid(2, 2, '#ffffff'))
    expect(mix.data[0]).toBe(128)
    const raw = await solid(10, 10, '#ffffff')
    maskRect(raw, 0, 0, 5, 5)
    expect(raw.data[0]).toBe(128)
    expect(raw.data[(9 * 10 + 9) * 4]).toBe(255)
  })

  it('prepare : recadre une référence « screen » et ramène la capture à sa taille', async () => {
    const dir = makeTmpDir('compare')
    const refFile = join(dir, 'ref.png')
    const curFile = join(dir, 'cur.png')
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#336699' } })
      .png()
      .toFile(refFile)
    await sharp({ create: { width: 2560, height: 1640, channels: 3, background: '#336699' } })
      .png()
      .toFile(curFile)
    const ref = loadRefMap().find((r) => r.id === 'dn6m6w')
    expect(ref).toBeDefined()
    const p = await prepare(
      { ...(ref as NonNullable<typeof ref>), crop: [10, 20, 200, 128] },
      refFile,
      curFile,
    )
    expect([p.ref.width, p.ref.height]).toEqual([200, 128])
    expect([p.cur.width, p.cur.height]).toEqual([200, 128])
    expect(existsSync(curFile)).toBe(true)
  })
})

describe('scènes et références', () => {
  it('13 scènes de départ, ids uniques, toutes reliées à une référence de ref-map', () => {
    expect(START_SCENES).toHaveLength(13)
    expect(new Set(ALL_SCENES.map((s) => s.id)).size).toBe(ALL_SCENES.length)
    const map = loadRefMap()
    for (const s of START_SCENES)
      expect(refsFor(map, s.ref, 'light').length, s.id).toBeGreaterThan(0)
  })

  it('selectScenes : défaut = départ ; id inconnu refusé', () => {
    expect(selectScenes(undefined)).toHaveLength(13)
    expect(selectScenes(['palette']).map((s) => s.id)).toEqual(['palette'])
    expect(() => selectScenes(['nope'])).toThrow(/inconnue/)
  })

  it('refsFor exclut les doublons et trie par k décroissant', () => {
    const r = refsFor(loadRefMap(), 'settings-ai', 'light')
    expect(r.every((x) => !x.duplicateOf)).toBe(true)
    expect(r.map((x) => x.k)).toEqual([...r.map((x) => x.k)].sort((a, b) => b - a))
  })
})
