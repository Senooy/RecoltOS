/**
 * On-disk layout. Every path stored in the database is RELATIVE to the
 * library root (movable without a migration).
 * No `electron` import: pure, testable under Node.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import { AppError } from '../../shared/errors'
import { shard } from '../../shared/ids'
import { DB_FILE } from '../db/open'

/** Roots served by `recolt://<libraryId>/<root>/<rel>`. */
export const LIBRARY_DIRS = [
  'items',
  'thumbs',
  'large',
  'posters',
  'previews',
  'display',
  'avatars',
  'remote',
  'spaces',
  'snapshots',
  'import',
  'tmp',
] as const
export type LibraryDir = (typeof LIBRARY_DIRS)[number]

export interface LibraryPaths {
  root: string
  db: string
  wal: string
  shm: string
  dir(name: LibraryDir): string
  /** Absolute path of a relative path stored in the database (refuses any escape from the root). */
  abs(rel: string): string
}

export function libraryPaths(root: string): LibraryPaths {
  const resolvedRoot = path.resolve(root)
  const db = path.join(resolvedRoot, DB_FILE)
  return {
    root: resolvedRoot,
    db,
    wal: `${db}-wal`,
    shm: `${db}-shm`,
    dir: (name) => path.join(resolvedRoot, name),
    abs: (rel) => resolveInside(resolvedRoot, rel),
  }
}

/**
 * Resolves `rel` under `root`; refuses absolute paths, `..`, the NUL byte and any escape from the
 * root (defense in depth; the protocol's real barrier remains realpath).
 */
export function resolveInside(root: string, rel: string): string {
  if (!rel || rel.includes('\0') || path.isAbsolute(rel) || rel.includes('\\')) {
    throw new AppError('validation', `chemin relatif invalide : ${JSON.stringify(rel)}`)
  }
  if (rel.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) {
    throw new AppError('validation', `chemin relatif invalide : ${JSON.stringify(rel)}`)
  }
  const base = path.resolve(root)
  const abs = path.resolve(base, rel)
  if (!abs.startsWith(base + path.sep)) {
    throw new AppError('validation', 'chemin hors de la bibliothèque')
  }
  return abs
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex')
const cleanExt = (ext: string) => {
  const e = ext.replace(/^\./, '').toLowerCase()
  if (!/^[a-z0-9]{1,8}$/.test(e)) throw new AppError('validation', `extension invalide : ${ext}`)
  return e
}

/** Canonical relative paths (`<root>/<ab>/<uuid>.<ext>`, ab = first 2 characters). */
export const rel = {
  original: (uuid: string, ext: string) => `items/${shard(uuid)}/${uuid}.${cleanExt(ext)}`,
  thumb: (uuid: string) => `thumbs/${shard(uuid)}/${uuid}.webp`,
  large: (uuid: string) => `large/${shard(uuid)}/${uuid}.webp`,
  poster: (uuid: string) => `posters/${shard(uuid)}/${uuid}.jpg`,
  preview: (uuid: string) => `previews/${shard(uuid)}/${uuid}.mp4`,
  display: (uuid: string) => `display/${shard(uuid)}/${uuid}.webp`,
  /** k = sha1(lower(handle)) over 16 hex chars. */
  avatar: (platform: string, handle: string) =>
    `avatars/${platform}/${sha1(handle.replace(/^@+/, '').toLowerCase()).slice(0, 16)}.jpg`,
  /** Remote media (quoted images, slides): `remote/<sha1(url)>.<ext>`. */
  remote: (url: string, ext: string) => `remote/${sha1(url)}.${cleanExt(ext)}`,
  spaceAsset: (sha256: string, ext: string) =>
    `spaces/assets/${sha256.slice(0, 2).toLowerCase()}/${sha256}.${cleanExt(ext)}`,
  spaceAssetThumb: (sha256: string) =>
    `spaces/assets/${sha256.slice(0, 2).toLowerCase()}/${sha256}.thumb.jpg`,
  tmp: (name: string) => `tmp/${name}`,
} as const

/** Folders of `userData`. */
export function userDataPaths(userData: string) {
  const u = path.resolve(userData)
  return {
    root: u,
    prefs: path.join(u, 'prefs.json'),
    libraries: path.join(u, 'libraries.json'),
    windowState: path.join(u, 'window-state.json'),
    librariesDir: path.join(u, 'libraries'),
    aiSandbox: path.join(u, 'ai-sandbox'),
    framesCache: path.join(u, 'cache', 'frames'),
    inbox: path.join(u, 'inbox'),
    hostJson: path.join(u, 'host.json'),
    logs: path.join(u, 'logs'),
  }
}

/** Default location of a library (`path: null` in `libraries.json`). */
export function defaultLibraryRoot(userData: string, id: string): string {
  return path.join(userDataPaths(userData).librariesDir, id)
}
