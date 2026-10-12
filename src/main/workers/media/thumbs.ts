/**
 * Image derivatives via sharp: `thumbs/` 800w webp q80, `large/` 1440w webp,
 * `display/` webp 2048 (HEIC, HEIF, TIFF, PSD). First frame only for an animation,
 * EXIF orientation applied, never enlarged. The original is never rewritten.
 */
import sharp, { type ResizeOptions, type WebpOptions } from 'sharp'
import { AppError } from '../../../shared/errors'
import type { MediaResult } from '../../../shared/worker-protocol'
import { assertAbs, assertDistinct, rawError, writeAtomic, type MediaTools } from './exec'
import { withReadable } from './foreign'

export const THUMB = { width: 800, quality: 80, effort: 4 } as const
export const LARGE = { width: 1440, quality: 82, effort: 4 } as const
/** WebP format limit on each side (very tall images: full-page captures, infographics). */
export const WEBP_MAX_EDGE = 16383
export const DISPLAY = { maxEdge: 2048, quality: 85, effort: 4 } as const

function checkWidth(w: unknown, expected: number, field: string): number {
  if (w !== expected) throw new AppError('validation', `${field} must be ${expected}`)
  return expected
}

async function resizeToWebp(
  src: string,
  dst: string,
  tools: MediaTools,
  signal: AbortSignal | undefined,
  resize: ResizeOptions,
  webp: WebpOptions,
): Promise<{ width: number; height: number; bytes: number }> {
  const s = assertAbs(src, 'src')
  const d = assertAbs(dst, 'dst')
  await assertDistinct(s, d)
  return withReadable(s, tools, signal, async ({ input }) => {
    try {
      return await writeAtomic(
        d,
        async (tmp) => {
          const info = await sharp(input, { animated: false })
            .rotate()
            .resize({ ...resize, withoutEnlargement: true })
            .webp(webp)
            .toFile(tmp)
          return { width: info.width, height: info.height, bytes: info.size }
        },
        '.webp',
      )
    } catch (err) {
      if (err instanceof AppError) throw err
      throw new AppError('decode_failed', 'unreadable image', rawError(err))
    }
  })
}

export function makeThumb(
  a: { src: string; dst: string; width: 800 },
  tools: MediaTools,
  signal?: AbortSignal,
): Promise<MediaResult<'makeThumb'>> {
  const width = checkWidth(a.width, THUMB.width, 'width')
  return resizeToWebp(
    a.src,
    a.dst,
    tools,
    signal,
    { width, height: WEBP_MAX_EDGE, fit: 'inside' },
    {
      quality: THUMB.quality,
      effort: THUMB.effort,
    },
  )
}

export function makeLarge(
  a: { src: string; dst: string; width: 1440 },
  tools: MediaTools,
  signal?: AbortSignal,
): Promise<MediaResult<'makeLarge'>> {
  const width = checkWidth(a.width, LARGE.width, 'width')
  return resizeToWebp(
    a.src,
    a.dst,
    tools,
    signal,
    { width, height: WEBP_MAX_EDGE, fit: 'inside' },
    {
      quality: LARGE.quality,
      effort: LARGE.effort,
    },
  )
}

export async function makeDisplay(
  a: { src: string; dst: string; maxEdge: 2048 },
  tools: MediaTools,
  signal?: AbortSignal,
): Promise<MediaResult<'makeDisplay'>> {
  const edge = checkWidth(a.maxEdge, DISPLAY.maxEdge, 'maxEdge')
  const r = await resizeToWebp(
    a.src,
    a.dst,
    tools,
    signal,
    { width: edge, height: edge, fit: 'inside' },
    { quality: DISPLAY.quality, effort: DISPLAY.effort },
  )
  return { width: r.width, height: r.height }
}

export const AVATAR = { size: 128, quality: 86 } as const

/** Author avatar: 128 px square cropped at the center, JPEG (`avatars/<platform>/<k>.jpg`). */
export async function makeAvatar(
  a: { src: string; dst: string; size: 128 },
  tools: MediaTools,
  signal?: AbortSignal,
): Promise<MediaResult<'makeAvatar'>> {
  const size = checkWidth(a.size, AVATAR.size, 'size')
  const s = assertAbs(a.src, 'src')
  const d = assertAbs(a.dst, 'dst')
  await assertDistinct(s, d)
  return withReadable(s, tools, signal, async ({ input }) => {
    try {
      return await writeAtomic(
        d,
        async (tmp) => {
          const info = await sharp(input, { animated: false })
            .rotate()
            .resize({ width: size, height: size, fit: 'cover' })
            .flatten({ background: '#ffffff' })
            .jpeg({ quality: AVATAR.quality, mozjpeg: true })
            .toFile(tmp)
          return { width: info.width, height: info.height, bytes: info.size }
        },
        '.jpg',
      )
    } catch (err) {
      if (err instanceof AppError) throw err
      throw new AppError('decode_failed', 'unreadable image', rawError(err))
    }
  })
}
