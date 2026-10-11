/**
 * Formats que sharp ne décode pas (HEIC/HEIF en HEVC, PSD) : décodage par `/usr/bin/sips`
 * (ARCHI §5.2 étape 4). L'original n'est jamais modifié.
 */
import { randomBytes } from 'node:crypto'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { AppError } from '../../../shared/errors'
import {
  DEFAULT_SIPS,
  assertAbs,
  assertFile,
  ioError,
  run,
  writeAtomic,
  type MediaTools,
} from './exec'

export type ForeignKind = 'heic' | 'heif' | 'psd'

export const FOREIGN_MIME: Record<ForeignKind, string> = {
  heic: 'image/heic',
  heif: 'image/heif',
  psd: 'image/vnd.adobe.photoshop',
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'])
const HEIF_BRANDS = new Set(['mif1', 'msf1'])
const AVIF_BRANDS = new Set(['avif', 'avis'])

/** Reconnaît HEIC/HEIF/PSD par les octets magiques (jamais par l'extension). */
export async function sniffForeign(abs: string): Promise<ForeignKind | null> {
  let fh
  try {
    fh = await open(abs, 'r')
  } catch (err) {
    throw ioError(err, abs)
  }
  try {
    const buf = Buffer.alloc(64)
    let bytesRead: number
    try {
      ;({ bytesRead } = await fh.read(buf, 0, 64, 0))
    } catch (err) {
      throw ioError(err, abs) // EISDIR : un dossier s'ouvre en lecture mais ne se lit pas
    }
    const head = buf.subarray(0, bytesRead)
    if (head.length >= 4 && head.toString('latin1', 0, 4) === '8BPS') return 'psd'
    if (head.length >= 12 && head.toString('latin1', 4, 8) === 'ftyp') {
      const boxSize = Math.min(head.readUInt32BE(0), head.length)
      const major = head.toString('latin1', 8, 12)
      const compat: string[] = []
      for (let o = 16; o + 4 <= boxSize; o += 4) compat.push(head.toString('latin1', o, o + 4))
      const brands = [major, ...compat]
      if (brands.some((b) => AVIF_BRANDS.has(b))) return null // AVIF : lu par sharp
      if (HEIC_BRANDS.has(major) || compat.some((b) => HEIC_BRANDS.has(b))) return 'heic'
      if (HEIF_BRANDS.has(major) || compat.some((b) => HEIF_BRANDS.has(b))) return 'heif'
    }
    return null
  } finally {
    await fh.close()
  }
}

function sipsPath(tools: MediaTools): string {
  return tools.sips ?? DEFAULT_SIPS
}

/**
 * Dimensions affichées : orientation EXIF 5 à 8 (rotation de 90°) → largeur et hauteur
 * permutées. sips recopie l'orientation HEIF dans le PNG/JPEG décodé sans tourner les pixels.
 */
export function orientedSize(meta: { width: number; height: number; orientation?: number }): {
  width: number
  height: number
} {
  const o = meta.orientation
  return o !== undefined && o >= 5 && o <= 8
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height }
}

function asDecodeFailed(err: unknown): unknown {
  if (err instanceof AppError && err.code === 'tool_failed') {
    return new AppError('decode_failed', err.message)
  }
  return err
}

/** `sips -s format <jpeg|png> <src> --out <dst>` ; écrit `dst` de façon atomique. */
export async function decodeForeign(
  a: { src: string; dst: string; format: 'jpeg' | 'png' },
  tools: MediaTools,
  signal?: AbortSignal,
): Promise<{ width: number; height: number }> {
  const src = assertAbs(a.src, 'src')
  const dst = assertAbs(a.dst, 'dst')
  if (a.format !== 'jpeg' && a.format !== 'png') {
    throw new AppError('validation', 'format attendu : jpeg ou png')
  }
  if (src === dst) throw new AppError('validation', 'la destination doit différer de la source')
  await assertFile(src)
  const ext = a.format === 'jpeg' ? '.jpg' : '.png'
  await writeAtomic(
    dst,
    async (tmp) => {
      await run(sipsPath(tools), ['-s', 'format', a.format, src, '--out', tmp], {
        tool: 'sips',
        timeoutMs: 120_000,
        signal,
      }).catch((err: unknown) => {
        throw asDecodeFailed(err)
      })
    },
    ext,
  )
  // Dimensions affichées (comme makeDisplay et probeImage), pas celles des pixels stockés.
  return orientedSize(await sharp(dst).metadata())
}

export interface Readable {
  /** Fichier lisible par sharp (l'original ou sa version décodée). */
  input: string
  foreign: ForeignKind | null
  cleanup(): Promise<void>
}

/**
 * Donne un fichier lisible par sharp. Pour HEIC/HEIF/PSD, décode en PNG (alpha conservé)
 * dans un dossier temporaire supprimé par `cleanup()`.
 */
export async function openReadable(
  abs: string,
  tools: MediaTools,
  signal?: AbortSignal,
): Promise<Readable> {
  const foreign = await sniffForeign(abs)
  if (!foreign) return { input: abs, foreign: null, cleanup: () => Promise.resolve() }
  const dir = await mkdtemp(join(tmpdir(), 'recolt-decoded-'))
  const out = join(dir, `${randomBytes(6).toString('hex')}.decoded.png`)
  try {
    await decodeForeign({ src: abs, dst: out, format: 'png' }, tools, signal)
  } catch (err) {
    await rm(dir, { recursive: true, force: true })
    throw err
  }
  return {
    input: out,
    foreign,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

export async function withReadable<T>(
  abs: string,
  tools: MediaTools,
  signal: AbortSignal | undefined,
  fn: (r: Readable) => Promise<T>,
): Promise<T> {
  const r = await openReadable(abs, tools, signal)
  try {
    return await fn(r)
  } finally {
    await r.cleanup()
  }
}
