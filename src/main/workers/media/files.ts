/**
 * Opérations fichier du media-worker : PNG pour le presse-papiers, sha256 en flux,
 * clonage APFS (`COPYFILE_FICLONE`) et archive zip (yazl) — ARCHI §2.2, §7.
 */
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { copyFile, lstat, stat } from 'node:fs/promises'
import { extname, isAbsolute, posix, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'
import yazl from 'yazl'
import { AppError } from '../../../shared/errors'
import type { MediaResult, ZipEntry } from '../../../shared/worker-protocol'
import { assertAbs, ioError, writeAtomic, type MediaTools } from './exec'
import { withReadable } from './foreign'

/** PNG (première image, orientation appliquée) ; `nativeImage` ne lit pas le webp (PLAN §1.12). */
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
      throw new AppError('decode_failed', `image illisible : ${(err as Error).message}`)
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

/** Erreur d'export zip → AppError typée (source modifiée, absente, ou E/S). */
function zipError(err: unknown, out: string): AppError {
  if (err instanceof AppError) return err
  const e = err as NodeJS.ErrnoException
  if (/unexpected number of bytes/.test(e.message ?? '')) {
    return new AppError('conflict', "fichier source modifié pendant l'export")
  }
  return ioError(err, e.path ?? out)
}

/** Copie par clonage APFS si possible (copie classique sinon), puis `rename` atomique. */
export async function cloneFile(a: {
  src: string
  dst: string
}): Promise<MediaResult<'cloneFile'>> {
  const src = assertAbs(a.src, 'src')
  const dst = assertAbs(a.dst, 'dst')
  if (resolve(src) === resolve(dst)) {
    throw new AppError('validation', 'la destination doit différer de la source')
  }
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

/** Chemin d'archive sûr : relatif, en `/`, sans `..` ni segment vide. */
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

/** Les médias sont déjà compressés : on les stocke tels quels (export rapide). */
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
 * Chemin source d'une entrée zip. Un chemin absolu (envoyé par main, de confiance) est pris tel
 * quel ; un chemin relatif est résolu depuis `root` et doit rester dans `root`.
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

/**
 * Archive `entries` dans `out` (écriture atomique). `abs` relatif est résolu depuis `root`.
 * Progression émise à chaque entrée lue.
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
  const entries = a.entries.map((e) => {
    const name = safeZipName(e.name)
    if (seen.has(name)) throw new AppError('validation', `entrée zip en double : ${name}`)
    seen.add(name)
    if (typeof e.abs !== 'string' || e.abs.length === 0) {
      throw new AppError('validation', 'chemin source manquant')
    }
    return { name, abs: resolveEntryAbs(root, e.abs) }
  })
  const total = entries.length
  return writeAtomic(
    out,
    async (tmp) => {
      const zip = new yazl.ZipFile()
      // `outputStream` est un PassThrough (typé ReadableStream par @types/yazl).
      const output = zip.outputStream as NodeJS.ReadableStream & { destroy(): void }
      const ws = createWriteStream(tmp)
      // yazl signale sur le ZipFile (pas sur outputStream) une source supprimée ou modifiée
      // pendant l'export : sans écouteur, `error` tuerait tout le worker. Écouteur permanent,
      // posé avant le premier flux : une 2e erreur ne doit pas être orpheline non plus.
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
          // lstat : un lien symbolique n'est pas suivi (il pourrait pointer hors de la bibliothèque).
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
              // yazl n'écoute pas les erreurs des flux « lazy » : on les relaie sur le ZipFile.
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
        // Le temporaire doit être fermé avant que writeAtomic ne le supprime.
        if (!ws.closed) await once(ws, 'close').catch(() => undefined)
        if (signal?.aborted) throw new AppError('cancelled', 'export annulé')
        throw zipError(err, out)
      }
      return { bytes: (await stat(tmp)).size }
    },
    '.zip',
  )
}
