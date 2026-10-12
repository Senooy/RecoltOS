/**
 * Assets des Spaces : fichiers déposés depuis le Finder ou le presse-papiers,
 * copiés par empreinte (SHA-256 des octets source) dans `spaces/assets/<ab>/<sha>.<ext>`, sans
 * jamais toucher l'original ni polluer la bibliothèque. Type vérifié par les octets magiques ;
 * HEIC/HEIF → JPEG et TIFF → PNG par `sips` (Chromium ne les décode pas), original gardé en
 * `<sha>.orig.<ext>` seulement si `keepOriginals`. Vignette : `<sha>.thumb.webp` (image, 800 px,
 * media-worker) ou `<sha>.thumb.jpg` (poster vidéo). Pas d'import `electron`.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants as fsc } from 'node:fs'
import path from 'node:path'
import type { AssetInfo } from '../../shared/dto/spaces'
import { AppError } from '../../shared/errors'
import { newUuid } from '../../shared/ids'
import { detectType, readHead } from '../ingest/media-type'
import type { MediaCaller } from '../jobs/handlers/types'
import type { LibraryContext } from '../library/library-context'
import { assetUrl, assetUrlOrNull } from '../protocol/urls'
import { assetThumbRel } from './repo'
import { mt } from '../i18n'

/** Fichiers par dépôt. */
export const MAX_ASSET_FILES = 200
/** Taille maximale d'un asset (4 Gio). */
export const MAX_ASSET_BYTES = 4 * 1024 ** 3
/** Vidéos acceptées (lecture Chromium). */
const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'webm'])

export interface AssetDeps {
  lib: Pick<LibraryContext, 'id' | 'paths'>
  media: MediaCaller
  keepOriginals?: boolean
  hasTool?: (name: 'ffmpeg' | 'ffprobe') => boolean
  log?: (msg: string, err?: unknown) => void
}

export const assetRelOf = (sha: string, ext: string) =>
  `spaces/assets/${sha.slice(0, 2)}/${sha}.${ext}`

async function sha256File(abs: string): Promise<string> {
  const h = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    createReadStream(abs)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve())
  })
  return h.digest('hex')
}

async function exists(abs: string): Promise<boolean> {
  try {
    await stat(abs)
    return true
  } catch {
    return false
  }
}

/** Chemin reçu du renderer : réel, fichier régulier, taille bornée. */
async function checkSource(input: string): Promise<{ abs: string; size: number }> {
  if (!path.isAbsolute(input) || input.includes('\0')) {
    throw new AppError('validation', mt().errors.invalidPath)
  }
  let abs: string
  try {
    abs = await realpath(input)
  } catch {
    throw new AppError('not_found', mt().errors.fileNotFound(path.basename(input)))
  }
  const st = await lstat(abs)
  if (st.isDirectory()) throw new AppError('validation', mt().errors.foldersRefused)
  if (!st.isFile()) throw new AppError('validation', mt().errors.notAFile(path.basename(input)))
  if (st.size === 0) throw new AppError('validation', mt().errors.emptyFile(path.basename(input)))
  if (st.size > MAX_ASSET_BYTES) throw new AppError('validation', mt().errors.fileTooLarge)
  return { abs, size: st.size }
}

async function copyAtomic(src: string, dst: string): Promise<void> {
  const tmp = `${dst}.${newUuid()}.part`
  try {
    await copyFile(src, tmp, fsc.COPYFILE_FICLONE)
    await rename(tmp, dst)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

/** Importe un fichier comme asset de space ; idempotent (même octets → même asset). */
export async function importAssetFile(deps: AssetDeps, input: string): Promise<AssetInfo> {
  const { abs } = await checkSource(input)
  const t = await detectType(await readHead(abs))
  if (!t) throw new AppError('unsupported', mt().errors.formatUnsupported(path.basename(abs)))
  if (t.mime === 'image/vnd.adobe.photoshop') {
    throw new AppError('unsupported', mt().errors.formatUnsupported(path.basename(abs)))
  }
  if (t.mediaType === 'video' && !VIDEO_EXT.has(t.ext)) {
    throw new AppError('unsupported', mt().errors.videoUnsupported(path.basename(abs)))
  }
  const sha = await sha256File(abs)
  const isHeic = t.mime === 'image/heic' || t.mime === 'image/heif'
  const isTiff = t.mime === 'image/tiff'
  const ext = isHeic ? 'jpg' : isTiff ? 'png' : t.ext === 'jpeg' ? 'jpg' : t.ext
  const mime = isHeic ? 'image/jpeg' : isTiff ? 'image/png' : t.mime
  const rel = assetRelOf(sha, ext)
  const dst = deps.lib.paths.abs(rel)
  await mkdir(path.dirname(dst), { recursive: true })
  if (!(await exists(dst))) {
    if (isHeic || isTiff) {
      await deps.media('decodeForeign', { src: abs, dst, format: isHeic ? 'jpeg' : 'png' })
      if (deps.keepOriginals) {
        const orig = deps.lib.paths.abs(assetRelOf(sha, `orig.${t.ext}`))
        if (!(await exists(orig))) await copyAtomic(abs, orig)
      }
    } else {
      await copyAtomic(abs, dst)
    }
  }
  const kind = t.mediaType
  let naturalWidth = 0
  let naturalHeight = 0
  try {
    if (kind === 'image') {
      const p = await deps.media('probeImage', { abs: dst })
      naturalWidth = p.width
      naturalHeight = p.height
    } else if (deps.hasTool?.('ffprobe') !== false) {
      const p = await deps.media('probeVideo', { abs: dst })
      naturalWidth = p.width
      naturalHeight = p.height
    }
  } catch (err) {
    deps.log?.(`[spaces] sonde impossible pour ${rel}`, err)
  }
  const thumbRel = assetThumbRel(rel, kind)
  const thumbAbs = deps.lib.paths.abs(thumbRel)
  let thumbOk = await exists(thumbAbs)
  if (!thumbOk) {
    try {
      if (kind === 'image') {
        const r = await deps.media('makeThumb', { src: dst, dst: thumbAbs, width: 800 })
        if (!naturalWidth && r.width > 0) {
          naturalWidth = r.width
          naturalHeight = r.height
        }
      } else if (deps.hasTool?.('ffmpeg') !== false) {
        const r = await deps.media('makePoster', { src: dst, dst: thumbAbs, atMs: 0 })
        if (!naturalWidth && r.width > 0) {
          naturalWidth = r.width
          naturalHeight = r.height
        }
      }
      thumbOk = await exists(thumbAbs)
    } catch (err) {
      deps.log?.(`[spaces] vignette impossible pour ${rel}`, err)
    }
  }
  if (!naturalWidth || !naturalHeight) {
    naturalWidth = kind === 'video' ? 1280 : 800
    naturalHeight = kind === 'video' ? 720 : 800
  }
  return {
    assetRel: rel,
    assetUrl: assetUrl(deps.lib.id, rel),
    thumbUrl: thumbOk ? assetUrlOrNull(deps.lib.id, thumbRel) : null,
    mime,
    kind,
    naturalWidth: Math.round(naturalWidth),
    naturalHeight: Math.round(naturalHeight),
  }
}

/** Plusieurs fichiers ; les échecs sont rendus à part (le dépôt continue). */
export async function importAssetFiles(
  deps: AssetDeps,
  paths: readonly string[],
): Promise<{ assets: AssetInfo[]; failed: { path: string; message: string }[] }> {
  if (paths.length > MAX_ASSET_FILES) {
    throw new AppError('limit_exceeded', mt().errors.tooManyFiles(MAX_ASSET_FILES))
  }
  const assets: AssetInfo[] = []
  const failed: { path: string; message: string }[] = []
  for (const p of paths) {
    try {
      assets.push(await importAssetFile(deps, p))
    } catch (err) {
      failed.push({ path: p, message: err instanceof Error ? err.message : String(err) })
    }
  }
  return { assets, failed }
}

/** Octets (presse-papiers, fichier d'un autre navigateur) → fichier temporaire → asset. */
export async function importAssetBuffer(deps: AssetDeps, bytes: Uint8Array): Promise<AssetInfo> {
  if (bytes.byteLength === 0) throw new AppError('validation', mt().errors.emptyContent)
  const tmpDir = deps.lib.paths.abs('tmp/spaces')
  await mkdir(tmpDir, { recursive: true })
  const tmp = path.join(tmpDir, `${newUuid()}.bin`)
  await writeFile(tmp, bytes)
  try {
    return await importAssetFile(deps, tmp)
  } finally {
    await rm(tmp, { force: true })
  }
}
