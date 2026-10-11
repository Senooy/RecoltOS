/**
 * Dérivés image par sharp (PLAN §1.6) : `thumbs/` 800w webp q80, `large/` 1440w webp,
 * `display/` webp 2048 (HEIC, HEIF, TIFF, PSD). Première image seulement pour une animation,
 * orientation EXIF appliquée, jamais d'agrandissement. L'original n'est jamais réécrit.
 */
import sharp, { type ResizeOptions, type WebpOptions } from 'sharp'
import { AppError } from '../../../shared/errors'
import type { MediaResult } from '../../../shared/worker-protocol'
import { assertAbs, writeAtomic, type MediaTools } from './exec'
import { withReadable } from './foreign'

export const THUMB = { width: 800, quality: 80, effort: 4 } as const
export const LARGE = { width: 1440, quality: 82, effort: 4 } as const
export const DISPLAY = { maxEdge: 2048, quality: 85, effort: 4 } as const

function checkWidth(w: unknown, expected: number, field: string): number {
  if (w !== expected) throw new AppError('validation', `${field} doit valoir ${expected}`)
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
  if (s === d) throw new AppError('validation', 'la destination doit différer de la source')
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
      throw new AppError('decode_failed', `image illisible : ${(err as Error).message}`)
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
    { width },
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
    { width },
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
