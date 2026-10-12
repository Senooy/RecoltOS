/**
 * Video derivatives via system ffmpeg:
 * - `posters/` jpg, width ≤ 1280;
 * - `previews/` mp4 540p, ≤ 8 s, silent, `h264_videotoolbox` with libx264 fallback, `+faststart`.
 */
import { stat } from 'node:fs/promises'
import sharp from 'sharp'
import { AppError } from '../../../shared/errors'
import type { MediaResult } from '../../../shared/worker-protocol'
import {
  assertAbs,
  assertDistinct,
  assertFile,
  requireTool,
  run,
  sourceFailure,
  writeAtomic,
  type MediaTools,
} from './exec'
import { probeVideo } from './probe'

export const POSTER_MAX_WIDTH = 1280
export const PREVIEW = { maxSeconds: 8, height: 540, bitrate: '1500k', maxFps: 30 } as const

async function nonEmpty(p: string): Promise<boolean> {
  try {
    return (await stat(p)).size > 0
  } catch {
    return false
  }
}

export function posterArgs(src: string, out: string, atMs: number): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    (Math.max(0, atMs) / 1000).toFixed(3),
    '-i',
    src,
    '-frames:v',
    '1',
    '-an',
    '-vf',
    `scale='min(${POSTER_MAX_WIDTH},iw)':-2`,
    '-q:v',
    '3',
    out,
  ]
}

export async function makePoster(
  a: { src: string; dst: string; atMs: number },
  tools: MediaTools,
  signal?: AbortSignal,
): Promise<MediaResult<'makePoster'>> {
  const src = assertAbs(a.src, 'src')
  const dst = assertAbs(a.dst, 'dst')
  if (!Number.isFinite(a.atMs)) throw new AppError('validation', 'atMs invalide')
  await assertDistinct(src, dst)
  const ffmpeg = requireTool(tools, 'ffmpeg')
  requireTool(tools, 'ffprobe')
  await assertFile(src)
  // Unreadable source or no video track → `decode_failed` (never a raw `tool_failed`).
  await probeVideo({ abs: src }, tools, signal)
  return writeAtomic(
    dst,
    async (tmp) => {
      let firstErr: unknown = null
      try {
        await run(ffmpeg, posterArgs(src, tmp, a.atMs), {
          tool: 'ffmpeg',
          timeoutMs: 60_000,
          signal,
        })
      } catch (err) {
        const e = sourceFailure(err)
        if (!(e instanceof AppError && e.code === 'tool_failed') || a.atMs <= 0) throw e
        firstErr = e
      }
      // Past the end (video shorter than expected), ffmpeg writes nothing: fall back to 0.
      if ((firstErr || !(await nonEmpty(tmp))) && a.atMs > 0) {
        await run(ffmpeg, posterArgs(src, tmp, 0), {
          tool: 'ffmpeg',
          timeoutMs: 60_000,
          signal,
        }).catch((err: unknown) => {
          throw sourceFailure(err)
        })
      }
      if (!(await nonEmpty(tmp))) throw new AppError('decode_failed', 'aucune image extraite')
      const meta = await sharp(tmp).metadata()
      return { width: meta.width, height: meta.height }
    },
    '.jpg',
  )
}

export type PreviewEncoder = 'h264_videotoolbox' | 'libx264'

export function previewArgs(src: string, out: string, encoder: PreviewEncoder): string[] {
  // "540p" = short side ≤ 540, without upscaling: landscape → height 540 (960×540), portrait →
  // width 540 (540×960), so that the preview of a vertical video stays sharp next to its poster.
  // Even dimensions (yuv420p); the other side follows the ratio (-2). ffmpeg has already applied the
  // display rotation: iw/ih are the dimensions seen by the user.
  const h = PREVIEW.height
  const vf = [
    `scale='if(gte(iw,ih),-2,trunc(min(${h},iw)/2)*2)':'if(gte(iw,ih),trunc(min(${h},ih)/2)*2,-2)':flags=bicubic`,
    'format=yuv420p',
  ].join(',')
  const extras: Record<PreviewEncoder, string[]> = {
    h264_videotoolbox: ['-b:v', PREVIEW.bitrate, '-profile:v', 'main', '-allow_sw', '1'],
    libx264: ['-preset', 'veryfast', '-crf', '26', '-profile:v', 'main'],
  }
  // The encoder is passed as-is: an unavailable encoder makes ffmpeg fail (fallback).
  const codec = ['-c:v', encoder, ...(Object.hasOwn(extras, encoder) ? extras[encoder] : [])]
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    src,
    '-map',
    '0:v:0',
    '-t',
    String(PREVIEW.maxSeconds),
    '-an',
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    '-vf',
    vf,
    '-fpsmax',
    String(PREVIEW.maxFps),
    ...codec,
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    out,
  ]
}

export async function makePreview(
  a: { src: string; dst: string; maxSeconds: 8; height: 540 },
  tools: MediaTools,
  signal?: AbortSignal,
  encoders: readonly PreviewEncoder[] = ['h264_videotoolbox', 'libx264'],
): Promise<MediaResult<'makePreview'>> {
  const src = assertAbs(a.src, 'src')
  const dst = assertAbs(a.dst, 'dst')
  if (a.maxSeconds !== PREVIEW.maxSeconds || a.height !== PREVIEW.height) {
    throw new AppError('validation', 'aperçu attendu : 8 s, 540p')
  }
  await assertDistinct(src, dst)
  const ffmpeg = requireTool(tools, 'ffmpeg')
  requireTool(tools, 'ffprobe')
  await assertFile(src)
  // Unreadable source or no video track → `decode_failed` before any encoding: no point in
  // re-running libx264 (up to 300 s) for a problem that comes from the file.
  await probeVideo({ abs: src }, tools, signal)
  return writeAtomic(
    dst,
    async (tmp) => {
      let lastErr: unknown = null
      for (const enc of encoders) {
        try {
          await run(ffmpeg, previewArgs(src, tmp, enc), {
            tool: 'ffmpeg',
            timeoutMs: 300_000,
            signal,
          })
          if (await nonEmpty(tmp)) {
            lastErr = null
            break
          }
          lastErr = new AppError('tool_failed', `${enc} n'a rien produit`)
        } catch (err) {
          // Binary missing or cancelled: no point trying the next encoder. Same if the
          // stderr points at the source (truncated file that ffprobe let through).
          const e = sourceFailure(err)
          if (e instanceof AppError && e.code !== 'tool_failed') throw e
          lastErr = e
        }
      }
      if (lastErr) throw lastErr instanceof Error ? lastErr : new Error('encodage impossible')
      const p = await probeVideo({ abs: tmp }, tools, signal)
      const bytes = (await stat(tmp)).size
      return { width: p.width, height: p.height, durationMs: p.durationMs, bytes }
    },
    '.mp4',
  )
}
