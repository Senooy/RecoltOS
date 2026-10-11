/**
 * Métadonnées d'image (sharp, ou sips pour HEIC/PSD) et de vidéo (ffprobe) — ARCHI §5.2 étape 6.
 */
import sharp, { type Metadata } from 'sharp'
import { AppError } from '../../../shared/errors'
import type { MediaResult } from '../../../shared/worker-protocol'
import { assertAbs, requireTool, run, type MediaTools } from './exec'
import { FOREIGN_MIME, orientedSize, sniffForeign, withReadable } from './foreign'

const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  tiff: 'image/tiff',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}

export async function probeImage(
  a: { abs: string },
  tools: MediaTools,
  signal?: AbortSignal,
): Promise<MediaResult<'probeImage'>> {
  const abs = assertAbs(a.abs, 'abs')
  const foreign = await sniffForeign(abs)
  if (foreign) {
    // HEIC/HEIF/PSD : on mesure la sortie décodée par sips (et son orientation), pas les
    // dimensions stockées (`sips -g pixelWidth` ignore l'orientation HEIF : photo iPhone en
    // portrait vue en paysage, en contradiction avec les dérivés redressés).
    const p = await withReadable(abs, tools, signal, (r) => probeSharp(r.input))
    return { ...p, mime: FOREIGN_MIME[foreign], isAnimated: false }
  }
  return probeSharp(abs)
}

async function probeSharp(input: string): Promise<MediaResult<'probeImage'>> {
  let meta: Metadata
  try {
    meta = await sharp(input).metadata()
  } catch (err) {
    throw new AppError('decode_failed', `image illisible : ${(err as Error).message}`)
  }
  const format = meta.format === 'heif' && meta.compression === 'av1' ? 'avif' : meta.format
  const mime = MIME_BY_FORMAT[format]
  if (!mime) throw new AppError('unsupported', `format d'image non pris en charge : ${format}`)
  // Pour une image animée, sharp rend la hauteur d'une page (première image).
  // Orientation EXIF 5 à 8 : rotation de 90° → dimensions permutées.
  const { width, height } = orientedSize({
    width: meta.width,
    height: meta.pageHeight ?? meta.height,
    ...(meta.orientation === undefined ? {} : { orientation: meta.orientation }),
  })
  return {
    width,
    height,
    mime,
    isAnimated: (meta.pages ?? 1) > 1,
    hasAlpha: meta.hasAlpha,
  }
}

export const PLAYABLE_CODECS = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1'])

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  duration?: string
  disposition?: { attached_pic?: number }
  tags?: Record<string, string>
  side_data_list?: { rotation?: number | string }[]
}
interface FfprobeOut {
  streams?: FfprobeStream[]
  format?: { duration?: string }
}

/** Rotation d'affichage en degrés (side data « Display Matrix », ou ancien tag `rotate`). */
export function streamRotation(s: FfprobeStream): number {
  for (const sd of s.side_data_list ?? []) {
    if (sd.rotation !== undefined) {
      const r = Number(sd.rotation)
      if (Number.isFinite(r)) return r
    }
  }
  const tag = s.tags?.rotate
  const r = tag === undefined ? 0 : Number(tag)
  return Number.isFinite(r) ? r : 0
}

/** Interprète la sortie JSON de ffprobe (exportée pour les tests). */
export function parseFfprobe(json: string): MediaResult<'probeVideo'> {
  let data: FfprobeOut
  try {
    data = JSON.parse(json) as FfprobeOut
  } catch {
    throw new AppError('decode_failed', 'sortie ffprobe illisible')
  }
  const streams = data.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  if (!video || !video.width || !video.height) {
    throw new AppError('decode_failed', 'aucune piste vidéo')
  }
  let width = video.width
  let height = video.height
  const rot = ((Math.round(streamRotation(video)) % 360) + 360) % 360
  if (rot === 90 || rot === 270) [width, height] = [height, width]
  const durSec = Number(data.format?.duration ?? video.duration ?? NaN)
  const codec = video.codec_name ?? 'inconnu'
  return {
    width,
    height,
    durationMs: Number.isFinite(durSec) ? Math.round(durSec * 1000) : 0,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    codec,
    playable: PLAYABLE_CODECS.has(codec),
  }
}

export async function probeVideo(
  a: { abs: string },
  tools: MediaTools,
  signal?: AbortSignal,
): Promise<MediaResult<'probeVideo'>> {
  const abs = assertAbs(a.abs, 'abs')
  const ffprobe = requireTool(tools, 'ffprobe')
  const { stdout } = await run(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', abs],
    { tool: 'ffprobe', timeoutMs: 60_000, signal },
  ).catch((err: unknown) => {
    if (err instanceof AppError && err.code === 'tool_failed') {
      throw new AppError('decode_failed', err.message)
    }
    throw err
  })
  return parseFfprobe(stdout)
}
