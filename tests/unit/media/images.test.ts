/**
 * WP-03 — critères 1 (images) et 2 : orientation EXIF, webp animé, HEIC/PSD par sips,
 * TIFF par sharp, dérivés webp, originaux intacts.
 */
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decodeForeign, sniffForeign } from '../../../src/main/workers/media/foreign'
import { probeImage } from '../../../src/main/workers/media/probe'
import { makeDisplay, makeLarge, makeThumb } from '../../../src/main/workers/media/thumbs'
import { toPng } from '../../../src/main/workers/media/files'
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
