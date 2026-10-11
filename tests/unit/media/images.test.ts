/**
 * WP-03 — critères 1 (images) et 2 : orientation EXIF, webp animé, HEIC/PSD par sips,
 * TIFF par sharp, dérivés webp, originaux intacts.
 */
import { mkdirSync, symlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decodeForeign, sniffForeign } from '../../../src/main/workers/media/foreign'
import { probeImage } from '../../../src/main/workers/media/probe'
import { makeDisplay, makeLarge, makeThumb } from '../../../src/main/workers/media/thumbs'
import { toPng } from '../../../src/main/workers/media/files'
import { palette } from '../../../src/main/workers/media/palette'
import { HAS_SIPS, generateMediaFixtures, type MediaFixtures } from '../../fixtures/media/generate'
import { TOOLS, makeTmp, sha256 } from './helpers'

let fx: MediaFixtures
const tmp = makeTmp()
const out = (name: string): string => join(tmp.dir, 'out', name)

beforeAll(async () => {
  fx = await generateMediaFixtures(join(tmp.dir, 'fx'))
}, 60_000)
afterAll(() => tmp.cleanup())

describe('probeImage', () => {
  it('JPEG orientation EXIF 6 : dimensions permutées', async () => {
    const raw = await sharp(fx.exif6Jpg).metadata()
    expect([raw.width, raw.height, raw.orientation]).toEqual([300, 200, 6])
    const p = await probeImage({ abs: fx.exif6Jpg }, TOOLS)
    expect(p).toMatchObject({ width: 200, height: 300, mime: 'image/jpeg', isAnimated: false })
  })

  it('webp animé : animé, dimensions de la première image', async () => {
    const p = await probeImage({ abs: fx.animWebp }, TOOLS)
    expect(p).toEqual({
      width: 120,
      height: 80,
      mime: 'image/webp',
      isAnimated: true,
      hasAlpha: false,
    })
  })

  it('PNG avec alpha et TIFF', async () => {
    expect(await probeImage({ abs: fx.alphaPng }, TOOLS)).toMatchObject({
      width: 320,
      height: 200,
      mime: 'image/png',
      hasAlpha: true,
    })
    expect(await probeImage({ abs: fx.tiff }, TOOLS)).toMatchObject({
      width: 320,
      height: 200,
      mime: 'image/tiff',
    })
  })

  it.skipIf(!HAS_SIPS)('HEIC et PSD : lus par sips', async () => {
    expect(await sniffForeign(fx.heic!)).toBe('heic')
    expect(await sniffForeign(fx.psd!)).toBe('psd')
    expect(await sniffForeign(fx.alphaPng)).toBeNull()
    expect(await probeImage({ abs: fx.heic! }, TOOLS)).toEqual({
      width: 320,
      height: 200,
      mime: 'image/heic',
      isAnimated: false,
      hasAlpha: true,
    })
    expect(await probeImage({ abs: fx.psd! }, TOOLS)).toMatchObject({
      width: 320,
      height: 200,
      mime: 'image/vnd.adobe.photoshop',
    })
  })

  it('HEIC orienté (6) : dimensions affichées = celles des dérivés', async (ctx) => {
    if (!fx.heicOriented) return ctx.skip() // swift indisponible : fixture non générée
    // sips ignore l'orientation HEIF : dimensions stockées 300×200.
    expect(await sniffForeign(fx.heicOriented)).toBe('heic')
    const before = sha256(fx.heicOriented)
    const p = await probeImage({ abs: fx.heicOriented }, TOOLS)
    expect(p).toEqual({
      width: 200,
      height: 300,
      mime: 'image/heic',
      isAnimated: false,
      hasAlpha: false,
    })
    const dec = await decodeForeign(
      { src: fx.heicOriented, dst: out('tmp/portrait.decoded.png'), format: 'png' },
      TOOLS,
    )
    expect(dec).toEqual({ width: 200, height: 300 })
    const d = await makeDisplay(
      { src: fx.heicOriented, dst: out('display/portrait.webp'), maxEdge: 2048 },
      TOOLS,
    )
    expect(d).toEqual({ width: p.width, height: p.height })
    // Pixels redressés : le coin rouge (haut-gauche stocké) est en haut à droite.
    const { data, info } = await sharp(out('display/portrait.webp'))
      .raw()
      .toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => {
      const o = (y * info.width + x) * info.channels
      return [data[o]!, data[o + 1]!, data[o + 2]!]
    }
    expect(px(info.width - 10, 10)[0]).toBeGreaterThan(200)
    expect(px(10, 10)[0]).toBeLessThan(60)
    const t = await makeThumb(
      { src: fx.heicOriented, dst: out('thumbs/portrait.webp'), width: 800 },
      TOOLS,
    )
    expect(t).toMatchObject({ width: 200, height: 300 })
    const png = await toPng({ abs: fx.heicOriented, maxEdge: 128 }, TOOLS)
    expect([png.width, png.height]).toEqual([85, 128])
    expect(sha256(fx.heicOriented)).toBe(before)
  })

  it('fichier illisible → decode_failed ; chemin relatif → validation', async () => {
    await expect(probeImage({ abs: join(fx.dir, '..', 'fx', 'nope.jpg') }, TOOLS)).rejects.toThrow()
    await expect(probeImage({ abs: 'relatif.jpg' }, TOOLS)).rejects.toMatchObject({
      code: 'validation',
    })
  })
})

describe('dérivés webp', () => {
  it('makeThumb EXIF 6 : orientation appliquée, pas d’agrandissement', async () => {
    const r = await makeThumb(
      { src: fx.exif6Jpg, dst: out('thumbs/ab/exif6.webp'), width: 800 },
      TOOLS,
    )
    expect(r).toMatchObject({ width: 200, height: 300 })
    expect(r.bytes).toBeGreaterThan(0)
    const m = await sharp(out('thumbs/ab/exif6.webp')).metadata()
    expect([m.format, m.width, m.height, m.orientation ?? 1]).toEqual(['webp', 200, 300, 1])
  })

  it('makeThumb webp animé → première image seulement', async () => {
    const dst = out('thumbs/anim.webp')
    await makeThumb({ src: fx.animWebp, dst, width: 800 }, TOOLS)
    const m = await sharp(dst).metadata()
    expect(m.pages ?? 1).toBe(1)
    const { data } = await sharp(dst).raw().toBuffer({ resolveWithObject: true })
    // Première image : rouge.
    expect(data[0]).toBeGreaterThan(200)
    expect(data[1]).toBeLessThan(40)
    expect(data[2]).toBeLessThan(40)
  })

  it('makeLarge 1440w et makeThumb 800w réduisent une grande image', async () => {
    const big = out('big.png')
    await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#808080' } })
      .png()
      .toFile(big)
    expect(await makeThumb({ src: big, dst: out('t.webp'), width: 800 }, TOOLS)).toMatchObject({
      width: 800,
      height: 533,
    })
    expect(await makeLarge({ src: big, dst: out('l.webp'), width: 1440 }, TOOLS)).toMatchObject({
      width: 1440,
      height: 960,
    })
    expect(await makeDisplay({ src: big, dst: out('d.webp'), maxEdge: 2048 }, TOOLS)).toEqual({
      width: 2048,
      height: 1365,
    })
  })

  it('TIFF → display webp par sharp', async () => {
    const before = sha256(fx.tiff)
    const d = await makeDisplay(
      { src: fx.tiff, dst: out('display/tiff.webp'), maxEdge: 2048 },
      TOOLS,
    )
    expect(d).toEqual({ width: 320, height: 200 })
    expect((await sharp(out('display/tiff.webp')).metadata()).format).toBe('webp')
    expect(sha256(fx.tiff)).toBe(before)
  })

  it('destination = source sous une autre écriture (/./, //, lien) → validation, original intact', async () => {
    const dir = out('same')
    mkdirSync(dir, { recursive: true })
    const src = join(dir, 'self.webp')
    await sharp({ create: { width: 300, height: 200, channels: 3, background: '#c03020' } })
      .webp()
      .toFile(src)
    symlinkSync(src, join(dir, 'alias.webp'))
    const before = sha256(src)
    const variants = [`${dir}/./self.webp`, `${dir}//self.webp`, join(dir, 'alias.webp')]
    for (const dst of variants) {
      await expect(makeThumb({ src, dst, width: 800 }, TOOLS)).rejects.toMatchObject({
        code: 'validation',
      })
      await expect(makeDisplay({ src, dst, maxEdge: 2048 }, TOOLS)).rejects.toMatchObject({
        code: 'validation',
      })
      await expect(makeLarge({ src, dst, width: 1440 }, TOOLS)).rejects.toMatchObject({
        code: 'validation',
      })
    }
    expect(sha256(src)).toBe(before)
  })

  it.skipIf(!HAS_SIPS)('source = destination sur un HEIC → refusé avant décodage', async () => {
    const before = sha256(fx.heic as string)
    await expect(
      decodeForeign(
        { src: fx.heic!, dst: `${dirname(fx.heic!)}/./${basename(fx.heic!)}`, format: 'png' },
        TOOLS,
      ),
    ).rejects.toMatchObject({ code: 'validation' })
    expect(sha256(fx.heic as string)).toBe(before)
  })

  it.skipIf(!HAS_SIPS)('HEIC → décodé par sips → display webp, original intact', async () => {
    const before = sha256(fx.heic as string)
    // sharp seul ne décode pas le HEVC : la voie sips est nécessaire.
    await expect(
      sharp(fx.heic as string)
        .png()
        .toBuffer(),
    ).rejects.toThrow()
    const dec = await decodeForeign(
      { src: fx.heic!, dst: out('tmp/heic.decoded.png'), format: 'png' },
      TOOLS,
    )
    expect(dec).toEqual({ width: 320, height: 200 })
    const d = await makeDisplay(
      { src: fx.heic!, dst: out('display/heic.webp'), maxEdge: 2048 },
      TOOLS,
    )
    expect(d).toEqual({ width: 320, height: 200 })
    const m = await sharp(out('display/heic.webp')).metadata()
    expect([m.format, m.hasAlpha]).toEqual(['webp', true])
    const t = await makeThumb({ src: fx.heic!, dst: out('thumbs/heic.webp'), width: 800 }, TOOLS)
    expect(t).toMatchObject({ width: 320, height: 200 })
    expect(sha256(fx.heic!)).toBe(before)
  })

  it.skipIf(!HAS_SIPS)('PSD → décodé par sips → display webp, original intact', async () => {
    const before = sha256(fx.psd as string)
    await expect(sharp(fx.psd as string).metadata()).rejects.toThrow()
    const dec = await decodeForeign(
      { src: fx.psd!, dst: out('tmp/psd.decoded.jpg'), format: 'jpeg' },
      TOOLS,
    )
    expect(dec).toEqual({ width: 320, height: 200 })
    expect((await sharp(out('tmp/psd.decoded.jpg')).metadata()).format).toBe('jpeg')
    const d = await makeDisplay(
      { src: fx.psd!, dst: out('display/psd.webp'), maxEdge: 2048 },
      TOOLS,
    )
    expect(d).toEqual({ width: 320, height: 200 })
    expect((await sharp(out('display/psd.webp')).metadata()).format).toBe('webp')
    expect(sha256(fx.psd!)).toBe(before)
  })

  it('sips absent → tool_missing pour un HEIC', async () => {
    if (!fx.heic) return
    await expect(
      makeDisplay(
        { src: fx.heic, dst: out('display/x.webp'), maxEdge: 2048 },
        { sips: '/nonexistent/sips' },
      ),
    ).rejects.toMatchObject({ code: 'tool_missing' })
  })

  it('aucun fichier partiel en cas d’échec', async () => {
    const { readdirSync, mkdirSync, writeFileSync } = await import('node:fs')
    const bad = out('bad/bad.jpg')
    mkdirSync(out('bad'), { recursive: true })
    writeFileSync(bad, 'pas une image')
    await expect(
      makeThumb({ src: bad, dst: out('bad/thumb.webp'), width: 800 }, TOOLS),
    ).rejects.toMatchObject({ code: 'decode_failed' })
    expect(readdirSync(out('bad'))).toEqual(['bad.jpg'])
  })

  it('toPng : PNG décodable, borné par maxEdge', async () => {
    const r = await toPng({ abs: fx.exif6Jpg, maxEdge: 150 }, TOOLS)
    expect([r.width, r.height]).toEqual([100, 150])
    const m = await sharp(Buffer.from(r.png)).metadata()
    expect([m.format, m.width, m.height]).toEqual(['png', 100, 150])
  })
})

describe('fichier source absent ou dossier', () => {
  const missing = join(tmp.dir, 'absent', 'nope.jpg')
  const ops: [string, () => Promise<unknown>][] = [
    ['probeImage', () => probeImage({ abs: missing }, TOOLS)],
    ['makeThumb', () => makeThumb({ src: missing, dst: out('m/t.webp'), width: 800 }, TOOLS)],
    ['makeLarge', () => makeLarge({ src: missing, dst: out('m/l.webp'), width: 1440 }, TOOLS)],
    [
      'makeDisplay',
      () => makeDisplay({ src: missing, dst: out('m/d.webp'), maxEdge: 2048 }, TOOLS),
    ],
    ['palette', () => palette({ src: missing }, TOOLS)],
    ['toPng', () => toPng({ abs: missing }, TOOLS)],
    [
      'decodeForeign',
      () => decodeForeign({ src: missing, dst: out('m/x.png'), format: 'png' }, TOOLS),
    ],
  ]
  for (const [name, call] of ops) {
    it(`${name} : fichier absent → not_found en français`, async () => {
      const err = await call().then(
        () => null,
        (e: unknown) => e,
      )
      expect(err).toMatchObject({ code: 'not_found' })
      expect((err as Error).message).toMatch(/^fichier introuvable : /)
      expect((err as Error).message).not.toMatch(/ENOENT|no such file/i)
    })
  }

  it('un dossier à la place du fichier → validation, pas internal', async () => {
    const dir = join(tmp.dir, 'un-dossier')
    mkdirSync(dir, { recursive: true })
    for (const call of [
      () => probeImage({ abs: dir }, TOOLS),
      () => makeThumb({ src: dir, dst: out('m/t2.webp'), width: 800 }, TOOLS),
      () => palette({ src: dir }, TOOLS),
      () => toPng({ abs: dir }, TOOLS),
    ]) {
      const err = await call().then(
        () => null,
        (e: unknown) => e,
      )
      expect(err).toMatchObject({ code: 'validation' })
      expect((err as Error).message).not.toMatch(/EISDIR|illegal operation/i)
    }
  })
})

describe('images très hautes (plafond WebP 16383 px)', () => {
  it.each([
    [1280, 26000],
    [800, 40000],
  ])(
    '%i×%i : makeThumb et makeLarge réussissent, côtés ≤ 16383',
    async (w, h) => {
      const src = join(tmp.dir, `tall-${w}x${h}.png`)
      await sharp({
        create: { width: w, height: h, channels: 3, background: '#3366cc' },
      })
        .png()
        .toFile(src)
      const t = await makeThumb({ src, dst: out(`tall/${w}-thumb.webp`), width: 800 }, TOOLS)
      const l = await makeLarge({ src, dst: out(`tall/${w}-large.webp`), width: 1440 }, TOOLS)
      for (const r of [t, l]) {
        expect(r.height).toBeLessThanOrEqual(16383)
        expect(r.width).toBeLessThanOrEqual(w)
        expect(r.bytes).toBeGreaterThan(0)
      }
      expect(t.width).toBeLessThanOrEqual(800)
      expect(l.width).toBeLessThanOrEqual(1440)
      const m = await sharp(out(`tall/${w}-large.webp`)).metadata()
      expect([m.width, m.height]).toEqual([l.width, l.height])
    },
    60_000,
  )
})
