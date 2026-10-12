/**
 * criteria 1 (video) and 4: ffprobe (rotation, duration, codec, `playable`), poster,
 * mp4 preview ≤ 8 s silent 540p `+faststart`, ffmpeg missing → `tool_missing` without crash.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppError } from '../../../src/shared/errors'
import { parseFfprobe, probeVideo } from '../../../src/main/workers/media/probe'
import { makePoster, makePreview, previewArgs } from '../../../src/main/workers/media/video'
import {
  FFMPEG,
  FFPROBE,
  generateMediaFixtures,
  type MediaFixtures,
} from '../../fixtures/media/generate'
import { TOOLS, makeTmp } from './helpers'

const HAS_FF = Boolean(FFMPEG && FFPROBE)
let fx: MediaFixtures
const tmp = makeTmp()
const out = (name: string): string => join(tmp.dir, 'out', name)

beforeAll(async () => {
  fx = await generateMediaFixtures(join(tmp.dir, 'fx'))
}, 120_000)
afterAll(() => tmp.cleanup())

/** Position of the top-level MP4 boxes (to check `+faststart`). */
function topBoxes(file: string): string[] {
  const buf = readFileSync(file)
  const boxes: string[] = []
  let o = 0
  while (o + 8 <= buf.length) {
    let size = buf.readUInt32BE(o)
    const type = buf.toString('latin1', o + 4, o + 8)
    if (size === 1) size = Number(buf.readBigUInt64BE(o + 8))
    if (size < 8) break
    boxes.push(type)
    o += size
  }
  return boxes
}

describe('parseFfprobe', () => {
  it('rotation via display matrix or tag, cover art ignored', () => {
    const base = {
      format: { duration: '3.5' },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'mjpeg',
          width: 50,
          height: 50,
          disposition: { attached_pic: 1 },
        },
        {
          codec_type: 'video',
          codec_name: 'hevc',
          width: 1920,
          height: 1080,
          side_data_list: [{ rotation: -90 }],
        },
      ],
    }
    expect(parseFfprobe(JSON.stringify(base))).toEqual({
      width: 1080,
      height: 1920,
      durationMs: 3500,
      hasAudio: false,
      codec: 'hevc',
      playable: true,
    })
    const tagged = {
      format: { duration: '1' },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'mpeg4',
          width: 640,
          height: 480,
          tags: { rotate: '270' },
        },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    }
    expect(parseFfprobe(JSON.stringify(tagged))).toMatchObject({
      width: 480,
      height: 640,
      hasAudio: true,
      playable: false,
    })
    expect(() => parseFfprobe('{"streams":[]}')).toThrow(/aucune piste vidéo/)
    expect(() => parseFfprobe('pas du json')).toThrow()
  })
})

describe.skipIf(!HAS_FF)('ffprobe / ffmpeg réels', () => {
  it('mp4 rotated by 90°: dimensions swapped, duration, codec, playable', async () => {
    const p = await probeVideo({ abs: fx.rot90Mp4! }, TOOLS)
    expect(p).toMatchObject({
      width: 240,
      height: 320,
      hasAudio: true,
      codec: 'h264',
      playable: true,
    })
    expect(p.durationMs).toBeGreaterThanOrEqual(1900)
    expect(p.durationMs).toBeLessThanOrEqual(2200)
  })

  it('makePoster: jpg ≤ 1280 wide, oriented; falls back to 0 past the end', async () => {
    const r = await makePoster(
      { src: fx.longMp4!, dst: out('posters/ab/long.jpg'), atMs: 1000 },
      TOOLS,
    )
    expect(r).toEqual({ width: 1280, height: 720 })
    const rot = await makePoster(
      { src: fx.rot90Mp4!, dst: out('posters/rot.jpg'), atMs: 60_000 },
      TOOLS,
    )
    expect(rot).toEqual({ width: 240, height: 320 })
    expect((await sharp(out('posters/rot.jpg')).metadata()).format).toBe('jpeg')
  })

  it('makePreview: h264 yuv420p mp4 ≤ 8 s, silent, 540p, moov before mdat', async () => {
    const dst = out('previews/ab/long.mp4')
    const r = await makePreview({ src: fx.longMp4!, dst, maxSeconds: 8, height: 540 }, TOOLS)
    expect(r.height).toBe(540)
    expect(r.width).toBe(960)
    expect(r.durationMs).toBeGreaterThan(7000)
    expect(r.durationMs).toBeLessThanOrEqual(8100)
    expect(r.bytes).toBeGreaterThan(0)
    const probe = JSON.parse(
      execFileSync(
        FFPROBE!,
        ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', dst],
        {
          encoding: 'utf8',
        },
      ),
    ) as {
      streams: { codec_type: string; codec_name: string; pix_fmt?: string; profile?: string }[]
    }
    expect(probe.streams.map((s) => s.codec_type)).toEqual(['video'])
    expect(probe.streams[0]).toMatchObject({ codec_name: 'h264', pix_fmt: 'yuv420p' })
    const boxes = topBoxes(dst)
    expect(boxes.indexOf('moov')).toBeGreaterThanOrEqual(0)
    expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'))
    // No temporary file left behind.
    expect(readdirSync(out('previews/ab'))).toEqual(['long.mp4'])
  })

  it('makePreview: rotated video → portrait, no upscaling; libx264 fallback', async () => {
    const r = await makePreview(
      { src: fx.rot90Mp4!, dst: out('previews/rot.mp4'), maxSeconds: 8, height: 540 },
      TOOLS,
      undefined,
      ['libx264'],
    )
    expect([r.width, r.height]).toEqual([240, 320])
    expect(r.durationMs).toBeLessThanOrEqual(2100)
  })

  it.runIf(HAS_FF)(
    'makePreview : petit côté ≤ 540 (portrait 1080×1920 → 540×960), sans agrandir',
    async () => {
      const gen = (name: string, size: string): string => {
        const f = join(tmp.dir, name)
        execFileSync(
          FFMPEG!,
          [
            '-v',
            'error',
            '-y',
            '-f',
            'lavfi',
            '-i',
            `testsrc=size=${size}:rate=10:duration=1`,
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            f,
          ],
          { stdio: 'ignore' },
        )
        return f
      }
      const cases: [string, string, [number, number]][] = [
        ['v1080.mp4', '1080x1920', [540, 960]],
        ['v360.mp4', '360x640', [360, 640]],
        ['h1080.mp4', '1920x1080', [960, 540]],
        ['sq800.mp4', '800x800', [540, 540]],
      ]
      for (const [name, size, expected] of cases) {
        const r = await makePreview(
          { src: gen(name, size), dst: out(`previews/${name}`), maxSeconds: 8, height: 540 },
          TOOLS,
          undefined,
          ['libx264'],
        )
        expect([size, r.width, r.height]).toEqual([size, ...expected])
      }
    },
    60_000,
  )

  it.runIf(HAS_FF)('missing video → not_found (probeVideo, makePoster, makePreview)', async () => {
    const src = join(tmp.dir, 'absente.mp4')
    for (const call of [
      () => probeVideo({ abs: src }, TOOLS),
      () => makePoster({ src, dst: out('posters/a.jpg'), atMs: 0 }, TOOLS),
      () => makePreview({ src, dst: out('previews/a.mp4'), maxSeconds: 8, height: 540 }, TOOLS),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'not_found' })
    }
  })

  it.runIf(HAS_FF)(
    'source corrompue ou sans piste vidéo → decode_failed partout, message français, sans repli',
    async () => {
      const audio = join(tmp.dir, 'audio.m4a')
      execFileSync(
        FFMPEG!,
        ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:a', 'aac', audio],
        { stdio: 'ignore' },
      )
      const junk = join(tmp.dir, 'junk.mp4')
      writeFileSync(junk, Buffer.alloc(4096, 7))
      // Truncated video: ffprobe may let it through, ffmpeg fails afterwards.
      const cut = join(tmp.dir, 'cut.mp4')
      writeFileSync(cut, readFileSync(fx.longMp4!).subarray(0, 3000))
      for (const src of [audio, junk, cut]) {
        const name = src.slice(src.lastIndexOf('/') + 1)
        const calls: [string, () => Promise<unknown>][] = [
          ['probeVideo', () => probeVideo({ abs: src }, TOOLS)],
          ['makePoster', () => makePoster({ src, dst: out(`bad/${name}.jpg`), atMs: 0 }, TOOLS)],
          [
            'makePoster@1s',
            () => makePoster({ src, dst: out(`bad/${name}-1.jpg`), atMs: 1000 }, TOOLS),
          ],
          [
            'makePreview',
            () =>
              makePreview({ src, dst: out(`bad/${name}.mp4`), maxSeconds: 8, height: 540 }, TOOLS),
          ],
        ]
        for (const [label, call] of calls) {
          const err = (await call().then(
            () => null,
            (e: unknown) => e,
          )) as AppError | null
          expect([name, label, err?.code]).toEqual([name, label, 'decode_failed'])
          // French message: never ffmpeg's English stderr; the raw output goes in details.
          expect(err?.message).not.toMatch(/Invalid data|does not contain|Failed to set|option/)
        }
      }
      // No leftover file (neither temporary nor destination).
      expect(existsSync(out('bad')) ? readdirSync(out('bad')) : []).toEqual([])
    },
    60_000,
  )

  it.runIf(HAS_FF)(
    'source valide mais encodeur cassé → tool_failed (et non decode_failed)',
    async () => {
      const err = await makePreview(
        { src: fx.rot90Mp4!, dst: out('enc/x.mp4'), maxSeconds: 8, height: 540 },
        TOOLS,
        undefined,
        ['nope_encoder' as never],
      ).catch((e: unknown) => e as AppError)
      expect(err).toMatchObject({ code: 'tool_failed' })
      expect((err as AppError).message).toMatch(/^ffmpeg a échoué \(code \d+\)$/)
      expect((err as AppError).details).toMatchObject({ tool: 'ffmpeg' })
    },
  )

  it.runIf(process.platform === 'darwin')(
    'h264_videotoolbox seul : encode sur ce Mac',
    async () => {
      const r = await makePreview(
        { src: fx.longMp4!, dst: out('previews/vt.mp4'), maxSeconds: 8, height: 540 },
        TOOLS,
        undefined,
        ['h264_videotoolbox'],
      )
      expect([r.width, r.height]).toEqual([960, 540])
      expect(r.durationMs).toBeLessThanOrEqual(8100)
    },
  )

  it('unavailable encoder → real failure, then fallback to the next one, no leftover file', async () => {
    // Alone, the unknown encoder really makes ffmpeg fail.
    await expect(
      makePreview(
        { src: fx.rot90Mp4!, dst: out('fallback/never.mp4'), maxSeconds: 8, height: 540 },
        TOOLS,
        undefined,
        ['nope_encoder' as never],
      ),
    ).rejects.toMatchObject({ code: 'tool_failed' })
    expect(readdirSync(out('fallback'))).toEqual([])
    const dst = out('fallback/ok.mp4')
    const r = await makePreview(
      { src: fx.rot90Mp4!, dst, maxSeconds: 8, height: 540 },
      TOOLS,
      undefined,
      ['nope_encoder' as never, 'libx264'],
    )
    expect(r.height).toBe(320)
    expect(readdirSync(out('fallback'))).toEqual(['ok.mp4'])
  })
})

describe('missing tools → tool_missing, no crash', () => {
  // The file exists (arbitrary bytes): only the tool is missing, not the source.
  const src = join(tmp.dir, 'quelconque.mp4')
  writeFileSync(src, 'pas une vraie vidéo')
  it('ffmpeg not resolved', async () => {
    await expect(
      makePreview(
        { src, dst: out('p/x.mp4'), maxSeconds: 8, height: 540 },
        { sips: '/usr/bin/sips' },
      ),
    ).rejects.toMatchObject({ code: 'tool_missing' })
    await expect(makePoster({ src, dst: out('p/x.jpg'), atMs: 0 }, {})).rejects.toMatchObject({
      code: 'tool_missing',
    })
    await expect(probeVideo({ abs: src }, {})).rejects.toMatchObject({ code: 'tool_missing' })
  })

  it('invalid ffmpeg path (binary removed) → tool_missing', async () => {
    const bogus = { ffmpeg: '/nonexistent/ffmpeg', ffprobe: '/nonexistent/ffprobe' }
    await expect(
      makePreview({ src, dst: out('p/y.mp4'), maxSeconds: 8, height: 540 }, bogus),
    ).rejects.toMatchObject({ code: 'tool_missing' })
    await expect(makePoster({ src, dst: out('p/y.jpg'), atMs: 0 }, bogus)).rejects.toThrow(
      /brew install ffmpeg/,
    )
    await expect(probeVideo({ abs: src }, bogus)).rejects.toMatchObject({ code: 'tool_missing' })
    // Failure before any write: no file (temporary or final) is left.
    expect(existsSync(out('p')) ? readdirSync(out('p')) : []).toEqual([])
  })

  it('preview arguments: silent, 8 s, +faststart, no metadata', () => {
    const a = previewArgs('/in.mov', '/out.mp4', 'h264_videotoolbox')
    expect(a).toEqual(
      expect.arrayContaining(['-an', '-t', '8', '-movflags', '+faststart', 'h264_videotoolbox']),
    )
    expect(a.join(' ')).toContain('min(540,ih)')
  })
})
