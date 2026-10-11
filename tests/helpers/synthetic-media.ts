/**
 * Médias synthétiques minuscules (QA §5.2) : images par `sharp`, vidéo par le ffmpeg SYSTÈME
 * (PLAN §1.16 : ni ffmpeg-static, ni binaire embarqué). Sans ffmpeg, `makeVideo` renvoie `false`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import sharp, { type Sharp } from 'sharp'

export type ImageFormat = 'webp' | 'jpeg' | 'png'

export interface SyntheticImageOptions {
  width?: number
  height?: number
  /** Couleur de fond `#rrggbb`. */
  color?: string
  /** Dégradé diagonal vers cette couleur (rend la palette non triviale). */
  to?: string
  format?: ImageFormat
}

const hex = (c: string): [number, number, number] => {
  const n = Number.parseInt(c.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Image synthétique ; sans `to`, aplat de couleur. */
export async function makeImage(opts: SyntheticImageOptions = {}): Promise<Buffer> {
  const { width = 64, height = 48, color = '#c8a064', to, format = 'webp' } = opts
  let img: Sharp
  if (to) {
    const a = hex(color)
    const b = hex(to)
    const raw = Buffer.alloc(width * height * 3)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = (x / Math.max(1, width - 1) + y / Math.max(1, height - 1)) / 2
        const o = (y * width + x) * 3
        raw[o] = Math.round(a[0] + (b[0] - a[0]) * t)
        raw[o + 1] = Math.round(a[1] + (b[1] - a[1]) * t)
        raw[o + 2] = Math.round(a[2] + (b[2] - a[2]) * t)
      }
    }
    img = sharp(raw, { raw: { width, height, channels: 3 } })
  } else {
    img = sharp({ create: { width, height, channels: 3, background: color } })
  }
  if (format === 'jpeg') return img.jpeg({ quality: 80 }).toBuffer()
  if (format === 'png') return img.png().toBuffer()
  return img.webp({ quality: 80 }).toBuffer()
}

export async function writeImage(file: string, opts: SyntheticImageOptions = {}): Promise<number> {
  mkdirSync(dirname(file), { recursive: true })
  const buf = await makeImage(opts)
  writeFileSync(file, buf)
  return buf.length
}

/** Cherche un exécutable (Homebrew puis PATH), comme `platform/binaries.ts` (PLAN §1.16). */
export function findBinary(name: string): string | null {
  const dirs = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    join(homedir(), '.local/bin'),
    ...(process.env.PATH ?? '').split(delimiter),
  ]
  for (const d of dirs) {
    if (!d) continue
    const p = join(d, name)
    if (existsSync(p)) return p
  }
  return null
}

export const findFfmpeg = (): string | null => findBinary('ffmpeg')

export interface SyntheticVideoOptions {
  width?: number
  height?: number
  seconds?: number
  fps?: number
}

/**
 * mp4 H.264 de quelques secondes (`testsrc`, une image clé par seconde : assez long pour tester le
 * seek). `false` si ffmpeg est absent ou échoue.
 */
export function makeVideo(file: string, opts: SyntheticVideoOptions = {}): boolean {
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) return false
  const { width = 64, height = 64, seconds = 3, fps = 10 } = opts
  mkdirSync(dirname(file), { recursive: true })
  const r = spawnSync(
    ffmpeg,
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=${width}x${height}:rate=${fps}`,
      '-t',
      String(seconds),
      '-g',
      String(fps),
      '-pix_fmt',
      'yuv420p',
      '-an',
      file,
    ],
    { encoding: 'utf8' },
  )
  return r.status === 0 && existsSync(file)
}
