/**
 * File typing by content: `file-type` on the first 4,100
 * bytes. HEIC, HEIF and PSD go through sips; TIFF and formats that Chromium does not display get
 * a 2048 webp `display/` derivative.
 */
import { open } from 'node:fs/promises'
import { fileTypeFromBuffer } from 'file-type'
import { AppError } from '../../shared/errors'
import { mt } from '../i18n'

export interface DetectedType {
  mime: string
  ext: string
  mediaType: 'image' | 'video'
  /** sharp cannot read this format: decode with sips first. */
  foreign: boolean
  /** Chromium does not display it: a `display/` webp is required. */
  needsDisplay: boolean
}

const IMAGE: Record<string, { ext: string; foreign?: boolean; display?: boolean }> = {
  'image/jpeg': { ext: 'jpg' },
  'image/png': { ext: 'png' },
  'image/gif': { ext: 'gif' },
  'image/webp': { ext: 'webp' },
  'image/avif': { ext: 'avif' },
  'image/bmp': { ext: 'bmp' },
  'image/tiff': { ext: 'tiff', display: true },
  'image/heic': { ext: 'heic', foreign: true, display: true },
  'image/heif': { ext: 'heif', foreign: true, display: true },
  'image/heic-sequence': { ext: 'heic', foreign: true, display: true },
  'image/heif-sequence': { ext: 'heif', foreign: true, display: true },
  'image/vnd.adobe.photoshop': { ext: 'psd', foreign: true, display: true },
}

const VIDEO: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/matroska': 'mkv',
  'video/x-m4v': 'm4v',
}

export const HEAD_BYTES = 4100

export async function readHead(abs: string, n = HEAD_BYTES): Promise<Buffer> {
  const fh = await open(abs, 'r')
  try {
    const buf = Buffer.alloc(n)
    const { bytesRead } = await fh.read(buf, 0, n, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

/** Type of a content, or `null` if it is not supported. */
export async function detectType(head: Uint8Array): Promise<DetectedType | null> {
  const ft = await fileTypeFromBuffer(head)
  if (!ft) return null
  const img = IMAGE[ft.mime]
  if (img) {
    return {
      mime: ft.mime === 'image/heic-sequence' ? 'image/heic' : ft.mime,
      ext: img.ext,
      mediaType: 'image',
      foreign: img.foreign === true,
      needsDisplay: img.display === true,
    }
  }
  const vext = VIDEO[ft.mime]
  if (vext) {
    return { mime: ft.mime, ext: vext, mediaType: 'video', foreign: false, needsDisplay: false }
  }
  return null
}

export async function requireType(head: Uint8Array, name: string): Promise<DetectedType> {
  const t = await detectType(head)
  if (!t) throw new AppError('unsupported', mt().errors.formatUnsupported(name))
  return t
}
