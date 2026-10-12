/**
 * File operations of the media-worker: PNG for the clipboard, streamed sha256,
 * APFS cloning (`COPYFILE_FICLONE`) and zip archive (yazl)
 */
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { copyFile, lstat, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'
import yazl from 'yazl'
import { AppError } from '../../../shared/errors'
import type { MediaResult, ZipEntry } from '../../../shared/worker-protocol'
import {
  assertAbs,
  assertDistinct,
  ioError,
  rawError,
  sameFile,
  writeAtomic,
  type MediaTools,
} from './exec'
import { withReadable } from './foreign'

/** PNG (first image, orientation applied); `nativeImage` does not read webp. */
export function toPng(
  a: { abs: string; maxEdge?: number },
  tools: MediaTools,
  signal?: AbortSignal,
): Promise<MediaResult<'toPng'>> {
  const abs = assertAbs(a.abs, 'abs')
  if (a.maxEdge !== undefined && !(Number.isInteger(a.maxEdge) && a.maxEdge > 0)) {
    throw new AppError('validation', 'maxEdge invalide')
  }
  return withReadable(abs, tools, signal, async ({ input }) => {
    try {
      let img = sharp(input, { animated: false }).rotate()
      if (a.maxEdge !== undefined) {
        img = img.resize({
          width: a.maxEdge,
          height: a.maxEdge,
          fit: 'inside',
          withoutEnlargement: true,
        })
      }
      const { data, info } = await img.png().toBuffer({ resolveWithObject: true })
      return { png: new Uint8Array(data), width: info.width, height: info.height }
    } catch (err) {
      throw new AppError('decode_failed', 'image illisible', rawError(err))
    }
  })
}

export async function hashFile(a: { abs: string }): Promise<MediaResult<'hashFile'>> {
  const abs = assertAbs(a.abs, 'abs')
  const hash = createHash('sha256')
  let bytes = 0
  try {
    for await (const chunk of createReadStream(abs, { highWaterMark: 1 << 20 })) {
      const b = chunk as Buffer
      bytes += b.length
      hash.update(b)
    }
  } catch (err) {
    throw ioError(err, abs)
  }
  return { sha256: hash.digest('hex'), bytes }
}

/** Zip export error → typed AppError (source modified, missing, or I/O). */
function zipError(err: unknown, out: string): AppError {
  if (err instanceof AppError) return err
  const e = err as NodeJS.ErrnoException
  if (/unexpected number of bytes/.test(e.message ?? '')) {
    return new AppError('conflict', "fichier source modifié pendant l'export")
  }
  return ioError(err, e.path ?? out)
}

/** Copy by APFS cloning if possible (classic copy otherwise), then atomic `rename`. */
export async function cloneFile(a: {
  src: string
  dst: string
}): Promise<MediaResult<'cloneFile'>> {
  const src = assertAbs(a.src, 'src')
  const dst = assertAbs(a.dst, 'dst')
  await assertDistinct(src, dst)
  try {
    return await writeAtomic(dst, async (tmp) => {
      await copyFile(src, tmp, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL)
      return { bytes: (await stat(tmp)).size }
    })
  } catch (err) {
    if (err instanceof AppError) throw err
    throw ioError(err, src)
  }
}

/** Safe archive path: relative, using `/`, without `..` or empty segment. */
export function safeZipName(name: string): string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 1024) {
    throw new AppError('validation', 'nom d’entrée zip invalide')
  }
  if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-z]:/i.test(name)) {
    throw new AppError('validation', `nom d’entrée zip invalide : ${name}`)
  }
  const parts = name.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new AppError('validation', `nom d’entrée zip invalide : ${name}`)
  }
  return posix.normalize(name)
}

/** Media are already compressed: stored as-is (fast export). */
const STORED_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.avif',
  '.heic',
  '.heif',
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.zip',
  '.gz',
])

export interface ZipProgress {
  done: number
  total: number
}

/**
 * Source path of a zip entry. An absolute path (sent by main, trusted) is taken as-is;
 * a relative path is resolved from `root` and must stay within `root`.
 */
export function resolveEntryAbs(root: string, abs: string): string {
  if (isAbsolute(abs)) return abs
  const resolved = resolve(root, abs)
  const rel = relative(root, resolved)
  if (rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    throw new AppError('validation', `chemin source hors de la bibliothèque : ${abs}`)
  }
  return resolved
}

/** True if `p` (already resolved) is strictly under `root` (itself resolved). */
function isInside(root: string, p: string): boolean {
  const rel = relative(root, p)
  return rel !== '' && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
}

/**
 * `realpath` tolerating a missing path: walks up to the first existing ancestor then appends the
 * rest (the output folder may not exist yet, `writeAtomic` creates it).
 */
async function realpathLoose(p: string): Promise<string> {
  const tail: string[] = []
  let cur = resolve(p)
  for (;;) {
    try {
      const real = await realpath(cur)
      return tail.length > 0 ? join(real, ...tail.reverse()) : real
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw ioError(err, cur)
      const parent = dirname(cur)
      if (parent === cur) return resolve(p)
      tail.push(basename(cur))
      cur = parent
    }
  }
}

/**
 * A relative entry must stay in the library once the symbolic links of the
 * intermediate folders are followed. `lstat` only sees the last segment: `dirlink/x` would pass.
 */
async function assertEntryContained(realRoot: string, rel: string, abs: string): Promise<void> {
  let real: string
  try {
    real = await realpath(abs)
  } catch (err) {
    throw ioError(err, abs)
  }
  if (!isInside(realRoot, real)) {
    throw new AppError('validation', `chemin source hors de la bibliothèque : ${rel}`)
  }
}

/**
 * Archive `entries` into `out` (atomic write). A relative `abs` is resolved from `root`.
 * Progress emitted for each entry read. `out` can be neither in `root` nor a source:
 * the final rename would replace the library file.
 */
export async function zipLibrary(
  a: { root: string; entries: ZipEntry[]; out: string },
  onProgress?: (p: ZipProgress) => void,
  signal?: AbortSignal,
): Promise<MediaResult<'zipLibrary'>> {
  const root = assertAbs(a.root, 'root')
  const out = assertAbs(a.out, 'out')
  if (!Array.isArray(a.entries)) throw new AppError('validation', 'entries attendu')
  const seen = new Set<string>()
  const entries = a.entries.map((raw: unknown) => {
    // A malformed entry (null, number, object without a name) is a validation error, not a
    // TypeError that would surface as `internal`.
    const e = raw as Partial<ZipEntry> | null
    if (!e || typeof e !== 'object') throw new AppError('validation', 'entrée zip invalide')
    const name = safeZipName(e.name as string)
    // APFS is case-insensitive: "A.txt" and "a.txt" would clash during extraction.
    const key = name.normalize('NFC').toLowerCase()
    if (seen.has(key)) throw new AppError('validation', `entrée zip en double : ${name}`)
    seen.add(key)
    if (typeof e.abs !== 'string' || e.abs.length === 0) {
      throw new AppError('validation', 'chemin source manquant')
    }
    const isRel = !isAbsolute(e.abs)
    return { name, abs: resolveEntryAbs(root, e.abs), rel: isRel ? e.abs : null }
  })
  const realRoot = await realpathLoose(root)
  // `out` must not be in the library, nor be one of the sources (same file, hard link
  // included): the atomic rename would replace the original.
  const outReal = join(await realpathLoose(dirname(out)), basename(out))
  if (isInside(realRoot, outReal)) {
    throw new AppError('validation', `sortie dans la bibliothèque refusée : ${out}`)
  }
  for (const e of entries) {
    if ((await realpathLoose(e.abs)) === outReal || (await sameFile(out, e.abs))) {
      throw new AppError('validation', `la sortie est une des sources : ${out}`)
    }
  }
  const total = entries.length
  return writeAtomic(
    out,
    async (tmp) => {
      const zip = new yazl.ZipFile()
      // `outputStream` is a PassThrough (typed ReadableStream by @types/yazl).
      const output = zip.outputStream as NodeJS.ReadableStream & { destroy(): void }
      const ws = createWriteStream(tmp)
      // yazl signals on the ZipFile (not on outputStream) a source deleted or modified
      // during the export: without a listener, `error` would kill the whole worker. Permanent listener,
      // set before the first stream: a 2nd error must not be orphaned either.
      const zipFailed = new Promise<never>((_, reject) => {
        zip.on('error', (err: Error) => {
          output.destroy()
          ws.destroy()
          reject(err)
        })
      })
      zipFailed.catch(() => undefined)
      let done = 0
      try {
        for (const e of entries) {
          // Relative entry: intermediate folders must not leave the root either.
          if (e.rel !== null) await assertEntryContained(realRoot, e.rel, e.abs)
          // lstat: a symbolic link is not followed (it could point outside the library).
          let st
          try {
            st = await lstat(e.abs)
          } catch (err) {
            throw ioError(err, e.abs)
          }
          if (st.isSymbolicLink()) {
            throw new AppError('validation', `lien symbolique refusé : ${e.abs}`)
          }
          if (!st.isFile()) throw new AppError('validation', `pas un fichier : ${e.abs}`)
          zip.addReadStreamLazy(
            e.name,
            {
              size: st.size,
              mtime: st.mtime,
              mode: 0o100644,
              compress: !STORED_EXT.has(extname(e.name).toLowerCase()),
            },
            (cb) => {
              const rs = createReadStream(e.abs)
              // yazl does not listen to errors from "lazy" streams: they are relayed to the ZipFile.
              rs.on('error', (err) => zip.emit('error', err))
              rs.once('end', () => {
                done++
                onProgress?.({ done, total })
              })
              cb(null, rs)
            },
          )
        }
        zip.end()
        await Promise.race([pipeline(output, ws, { signal }), zipFailed])
      } catch (err) {
        output.destroy()
        ws.destroy()
        // The temporary file must be closed before writeAtomic deletes it.
        if (!ws.closed) await once(ws, 'close').catch(() => undefined)
        if (signal?.aborted) throw new AppError('cancelled', 'export annulé')
        throw zipError(err, out)
      }
      return { bytes: (await stat(tmp)).size }
    },
    '.zip',
  )
}
