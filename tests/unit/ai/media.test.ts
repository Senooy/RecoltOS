import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildAiInput } from '../../../src/main/ai/input'
import {
  getVideoKeyframes,
  keyframeTimes,
  pickSlides,
  prepareImageForAi,
  type FrameAt,
} from '../../../src/main/ai/media'
import { generateMediaFixtures, FFMPEG, type MediaFixtures } from '../../fixtures/media/generate'
import { makeTmp } from '../media/helpers'
import { makeAiLib, post, writeImage, type AiLib } from './helpers'

let fx: MediaFixtures
let tmp: { dir: string; cleanup(): void }
let a: AiLib

beforeAll(async () => {
  tmp = makeTmp('recolt-ai-media-')
  fx = await generateMediaFixtures(join(tmp.dir, 'fx'))
  a = makeAiLib()
})
afterAll(() => {
  a.cleanup()
  tmp.cleanup()
})

const job = (n: number) => join(a.userData, 'ai-sandbox', 'claude', 'jobs', String(n))

describe('media preparation', () => {
  it('JPEG ≤ 1568 px, EXIF removed', async () => {
    const rel = await writeImage(a.lib, 'items/aa/exif.jpg', '#884422', [3000, 2000])
    const before = await sharp(a.lib.paths.abs(rel)).metadata()
    expect(before.exif).toBeDefined()
    const m = await prepareImageForAi(a.media, a.lib.paths.abs(rel), job(1), 'img1.jpg')
    expect(m).toMatchObject({ mime: 'image/jpeg', width: 1568, height: 1045 })
    const meta = await sharp(m.path).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.exif).toBeUndefined()
    expect(meta.icc).toBeUndefined()
    expect(statSync(m.path).size).toBe(m.bytes)
    // EXIF orientation applied, then removed.
    const r = await prepareImageForAi(a.media, fx.exif6Jpg, job(1), 'img2.jpg')
    expect([r.width, r.height]).toEqual([200, 300])
    expect((await sharp(r.path).metadata()).orientation).toBeUndefined()
  })

  it('pickSlides: cover, median, last; videos ignored', () => {
    const s = Array.from({ length: 6 }, (_, i) => ({
      index: i,
      path: `/s${i}`,
      type: 'image' as const,
    }))
    expect(pickSlides(s).map((x) => x.index)).toEqual([0, 3, 5])
    const mixed = [...s.slice(0, 2), { index: 2, path: '', type: 'video' as const }]
    expect(pickSlides(mixed).map((x) => x.index)).toEqual([0, 1])
  })

  it('keyframe instants', () => {
    expect(keyframeTimes(10)).toEqual([1, 5, 9])
    expect(keyframeTimes(1)).toEqual([0, 0.5])
    expect(keyframeTimes(2)[2]).toBeCloseTo(1.7)
  })

  it.skipIf(!FFMPEG)('real video: 3 keyframes cached and reused', async () => {
    const r = await getVideoKeyframes({
      itemUuid: 'vid-1',
      video: fx.longMp4!,
      fallbackImage: null,
      cacheDir: a.framesDir,
      durationSec: () => Promise.resolve(10),
      extract: async (src, dst, at) => {
        await a.media('extractFrame', { src, dst, ...at, maxEdge: 1024 })
        return statSync(dst).size > 0
      },
    })
    expect(r.fallback).toBe(false)
    expect(r.frames).toHaveLength(3)
    for (const f of r.frames) {
      const meta = await sharp(f).metadata()
      expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(1024)
    }
    const again = await getVideoKeyframes({
      itemUuid: 'vid-1',
      video: fx.longMp4!,
      fallbackImage: null,
      cacheDir: a.framesDir,
      durationSec: () => Promise.resolve(10),
      extract: () => Promise.reject(new Error('must not be called')),
    })
    expect(again.frames).toEqual(r.frames)
  })

  it('last frame missing → fallback at 0.80·d', async () => {
    const calls: FrameAt[] = []
    const r = await getVideoKeyframes({
      itemUuid: 'vid-2',
      video: '/v.mp4',
      fallbackImage: null,
      cacheDir: a.framesDir,
      durationSec: () => Promise.resolve(10),
      extract: (_src, dst, at) => {
        calls.push(at)
        // ffmpeg writes nothing near the end
        if ('atMs' in at && at.atMs >= 8_500) return Promise.resolve(false)
        mkdirSync(join(dst, '..'), { recursive: true })
        copyFileSync(fx.exif6Jpg, dst)
        return Promise.resolve(true)
      },
    })
    expect(r.frames).toHaveLength(3)
    expect(calls).toEqual([{ atMs: 1000 }, { atMs: 5000 }, { atMs: 9000 }, { atMs: 8000 }])
  })

  it('no frame extracted → fallback to the poster (one image)', async () => {
    const r = await getVideoKeyframes({
      itemUuid: 'vid-3',
      video: '/v.mp4',
      fallbackImage: '/poster.jpg',
      cacheDir: a.framesDir,
      durationSec: () => Promise.resolve(4),
      extract: () => Promise.resolve(false),
    })
    expect(r).toMatchObject({ frames: ['/poster.jpg'], fallback: true })
    expect(existsSync(join(a.framesDir, 'vid-3'))).toBe(false)
  })
})

describe('building the input', () => {
  it('carousel of 6 slides → 3 JPEGs (1, 4, 6), video slide ignored', async () => {
    const media = []
    for (let i = 0; i < 6; i++) {
      const rel = await writeImage(
        a.lib,
        `items/cc/slide${i}.jpg`,
        i % 2 ? '#aa0000' : '#00aa00',
        [800, 600],
      )
      media.push({ mediaType: 'image' as const, fileRel: rel, status: 'ok' as const })
    }
    media.push({ mediaType: 'video' as const, fileRel: null, status: 'remote' as const })
    const { id } = a.lib.repos.items.insertWithMedia(
      { kind: 'image', source: 'instagram', postMeta: post({ text: 'Mon carrousel' }) },
      media,
    )
    const item = a.lib.repos.items.getById(id)!
    const { input } = await buildAiInput(
      { lib: a.lib, media: a.media, hasTool: () => true, framesDir: a.framesDir },
      item,
      job(10),
      'analyze',
    )
    expect(input.media).toHaveLength(3)
    expect(input.context.carousel).toEqual({ total: 7, slideNumbers: [1, 4, 6] })
    expect(input.context.post?.caption).toBe('Mon carrousel')
    for (const m of input.media) expect(existsSync(m.path)).toBe(true)
  })

  it('text post: no image; without text: the capture', async () => {
    const rel = await writeImage(a.lib, 'items/dd/tweet.jpg', '#ffffff', [600, 400])
    const withText = a.lib.repos.items.insertWithMedia(
      {
        kind: 'tweet',
        source: 'x',
        sourceUrl: 'https://x.com/bob/status/1?token=SECRET',
        postMeta: post({ platform: 'x', text: 'Bonjour' }),
      },
      [{ mediaType: 'image', fileRel: rel, role: 'screenshot' }],
    )
    const deps = { lib: a.lib, media: a.media, hasTool: () => true, framesDir: a.framesDir }
    const r1 = await buildAiInput(deps, a.lib.repos.items.getById(withText.id)!, job(11), 'analyze')
    expect(r1.input.media).toHaveLength(0)
    expect(r1.input.context).toMatchObject({ sourceLabel: 'X', sourceHost: 'x.com' })
    expect(JSON.stringify(r1.input)).not.toContain('SECRET')
    const noText = a.lib.repos.items.insertWithMedia({ kind: 'tweet', source: 'x' }, [
      { mediaType: 'image', fileRel: rel, role: 'screenshot' },
    ])
    const r2 = await buildAiInput(deps, a.lib.repos.items.getById(noText.id)!, job(12), 'analyze')
    expect(r2.input.media).toHaveLength(1)
  })

  it.skipIf(!FFMPEG)('video: 3 keyframes ≤ 1024 px and duration', async () => {
    mkdirSync(a.lib.paths.abs('items/ee').replace(/\/ee$/, '/ee'), { recursive: true })
    copyFileSync(fx.longMp4!, a.lib.paths.abs('items/ee/v.mp4'))
    const { id } = a.lib.repos.items.insertWithMedia({ kind: 'video', source: 'instagram' }, [
      { mediaType: 'video', fileRel: 'items/ee/v.mp4', status: 'ok', durationMs: 10_000 },
    ])
    const { input } = await buildAiInput(
      { lib: a.lib, media: a.media, hasTool: () => true, framesDir: a.framesDir },
      a.lib.repos.items.getById(id)!,
      job(13),
      'analyze',
    )
    expect(input.media).toHaveLength(3)
    expect(input.context.videoDurationSec).toBe(10)
    for (const m of input.media) expect(Math.max(m.width, m.height)).toBeLessThanOrEqual(1024)
  })
})
