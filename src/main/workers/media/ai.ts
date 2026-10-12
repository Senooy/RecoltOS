/**
 * Preparation of media sent to the AI, in the media-worker:
 * - `aiImage`: JPEG q85, side ≤ `maxEdge` (1568), orientation applied, white background, NO
 *   metadata (EXIF/GPS removed: no `withMetadata`), first frame of an animation;
 * - `extractFrame`: one frame of a video at `atMs` (or at `fromEndMs` from the end, `-sseof`), JPEG
 *   ≤ `maxEdge` (1024). No internal fallback: an empty file gives `decode_failed`, the fallback strategy
 *   (0.80·d then `-sseof -0.5`) belongs to `ai/media.ts`.
 */
import { stat } from 'node:fs/promises'
import sharp from 'sharp'
import { AppError } from '../../../shared/errors'
import type { MediaResult } from '../../../shared/worker-protocol'
import {
  assertAbs,
  assertDistinct,
  assertFile,
  rawError,
  requireTool,
  run,
  sourceFailure,
  writeAtomic,
  type MediaTools,
} from './exec'
import { withReadable } from './foreign'

export const AI_IMAGE_MAX_EDGE = 1568
export const AI_FRAME_MAX_EDGE = 1024

function edge(v: unknown, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 64 || v > max)
    throw new AppError('validation', `invalid maxEdge (64..${max})`)
  return v
}

export function aiImage(
  a: { src: string; dst: string; maxEdge: number },
  tools: MediaTools,
  signal?: AbortSignal,
): Promise<MediaResult<'aiImage'>> {
  const s = assertAbs(a.src, 'src')
  const d = assertAbs(a.dst, 'dst')
  const max = edge(a.maxEdge, AI_IMAGE_MAX_EDGE)
  return assertDistinct(s, d).then(() =>
    withReadable(s, tools, signal, async ({ input }) => {
      try {
        return await writeAtomic(
          d,
          async (tmp) => {
            const info = await sharp(input, {
              animated: false,
              failOn: 'none',
              limitInputPixels: 268402689,
            })
              .rotate()
              .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
              .flatten({ background: '#ffffff' })
              .jpeg({ quality: 85 })
              .toFile(tmp)
            return { width: info.width, height: info.height, bytes: info.size }
          },
          '.jpg',
        )
      } catch (err) {
        if (err instanceof AppError) throw err
        throw new AppError('decode_failed', 'unreadable image', rawError(err))
      }
    }),
  )
}

export function frameArgs(
  src: string,
  out: string,
  at: { atMs?: number; fromEndMs?: number },
  maxEdge: number,
): string[] {
  const seek =
    at.fromEndMs !== undefined
      ? ['-sseof', (-Math.abs(at.fromEndMs) / 1000).toFixed(3)]
      : ['-ss', (Math.max(0, at.atMs ?? 0) / 1000).toFixed(3)]
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...seek,
    '-i',
    src,
    '-frames:v',
    '1',
    '-an',
    '-vf',
    `scale=${maxEdge}:${maxEdge}:force_original_aspect_ratio=decrease`,
    '-q:v',
    '3',
    out,
  ]
}

export async function extractFrame(
  a: { src: string; dst: string; atMs?: number; fromEndMs?: number; maxEdge: number },
  tools: MediaTools,
  signal?: AbortSignal,
): Promise<MediaResult<'extractFrame'>> {
  const src = assertAbs(a.src, 'src')
  const dst = assertAbs(a.dst, 'dst')
  const max = edge(a.maxEdge, AI_FRAME_MAX_EDGE)
  if (a.atMs === undefined && a.fromEndMs === undefined)
    throw new AppError('validation', 'atMs or fromEndMs required')
  for (const v of [a.atMs, a.fromEndMs])
    if (v !== undefined && !Number.isFinite(v))
      throw new AppError('validation', 'invalid timestamp')
  await assertDistinct(src, dst)
  const ffmpeg = requireTool(tools, 'ffmpeg')
  await assertFile(src)
  return writeAtomic(
    dst,
    async (tmp) => {
      try {
        await run(ffmpeg, frameArgs(src, tmp, a, max), {
          tool: 'ffmpeg',
          timeoutMs: 60_000,
          signal,
        })
      } catch (err) {
        throw sourceFailure(err)
      }
      // ffmpeg may exit with code 0 without writing anything near the end.
      const size = await stat(tmp).then(
        (s) => s.size,
        () => 0,
      )
      if (size <= 0) throw new AppError('decode_failed', 'no frame extracted')
      const meta = await sharp(tmp).metadata()
      return { width: meta.width, height: meta.height, bytes: size }
    },
    '.jpg',
  )
}
