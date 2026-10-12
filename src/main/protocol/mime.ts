/**
 * MIME type served by `recolt://`, based on the extension (library files are named
 * by main: `<uuid>.<ext>`, extension already typed at ingestion). Unknown: `application/octet-stream`
 * (with `nosniff`, the browser guesses nothing).
 */
import path from 'node:path'

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  psd: 'image/vnd.adobe.photoshop',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
}

export function mimeFromPath(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}
