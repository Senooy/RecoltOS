/**
 * WP-03 — critères 1 (vidéo) et 4 : ffprobe (rotation, durée, codec, `playable`), poster,
 * aperçu mp4 ≤ 8 s muet 540p `+faststart`, ffmpeg absent → `tool_missing` sans crash.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

/** Position des boîtes MP4 de premier niveau (pour vérifier `+faststart`). */
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
  it('rotation par matrice d’affichage ou par tag, pochette ignorée', () => {
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
  it('mp4 tourné de 90° : dimensions permutées, durée, codec, playable', async () => {
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

  it('makePoster : jpg ≤ 1280 de large, orienté ; repli à 0 au-delà de la fin', async () => {
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

  it('makePreview : mp4 h264 yuv420p ≤ 8 s, muet, 540p, moov avant mdat', async () => {
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
    // Aucun fichier temporaire laissé à côté.
    expect(readdirSync(out('previews/ab'))).toEqual(['long.mp4'])
  })

  it('makePreview : vidéo tournée → portrait, sans agrandissement ; repli libx264', async () => {
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

  it.runIf(HAS_FF)('vidéo absente → not_found (probeVideo, makePoster, makePreview)', async () => {
    const src = join(tmp.dir, 'absente.mp4')
    for (const call of [
      () => probeVideo({ abs: src }, TOOLS),
      () => makePoster({ src, dst: out('posters/a.jpg'), atMs: 0 }, TOOLS),
      () => makePreview({ src, dst: out('previews/a.mp4'), maxSeconds: 8, height: 540 }, TOOLS),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'not_found' })
    }
  })

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

  it('encodeur indisponible → échec réel, puis repli sur le suivant, sans fichier résiduel', async () => {
    // Seul, l'encodeur inconnu fait vraiment échouer ffmpeg.
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

describe('outils absents → tool_missing, pas de crash', () => {
  // Le fichier existe (octets quelconques) : seul l'outil manque, pas la source.
  const src = join(tmp.dir, 'quelconque.mp4')
  writeFileSync(src, 'pas une vraie vidéo')
  it('ffmpeg non résolu', async () => {
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

  it('chemin ffmpeg invalide (binaire supprimé) → tool_missing', async () => {
    const bogus = { ffmpeg: '/nonexistent/ffmpeg', ffprobe: '/nonexistent/ffprobe' }
    await expect(
      makePreview({ src, dst: out('p/y.mp4'), maxSeconds: 8, height: 540 }, bogus),
    ).rejects.toMatchObject({ code: 'tool_missing' })
    await expect(makePoster({ src, dst: out('p/y.jpg'), atMs: 0 }, bogus)).rejects.toThrow(
      /brew install ffmpeg/,
    )
    await expect(probeVideo({ abs: src }, bogus)).rejects.toMatchObject({ code: 'tool_missing' })
    expect(existsSync(out('p'))).toBe(true)
    expect(readdirSync(out('p'))).toEqual([])
  })

  it('arguments d’aperçu : muet, 8 s, +faststart, sans métadonnées', () => {
    const a = previewArgs('/in.mov', '/out.mp4', 'h264_videotoolbox')
    expect(a).toEqual(
      expect.arrayContaining(['-an', '-t', '8', '-movflags', '+faststart', 'h264_videotoolbox']),
    )
    expect(a.join(' ')).toContain('min(540,ih)')
  })
})
