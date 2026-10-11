/**
 * `data.storage` : taille de chaque dossier de la bibliothèque (parcours asynchrone, liens
 * symboliques ignorés) et de la base (db + wal + shm). Pas d'import electron.
 */
import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { LibraryContext } from '../library/library-context'

const ROOTS = [
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
] as const

export type StorageRoot = (typeof ROOTS)[number]

export async function dirSize(dir: string): Promise<number> {
  let total = 0
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) total += await dirSize(abs)
    else if (e.isFile()) {
      try {
        total += (await fs.stat(abs)).size
      } catch {
        // fichier disparu entre-temps
      }
    }
  }
  return total
}

export async function storageBreakdown(
  lib: Pick<LibraryContext, 'paths'>,
): Promise<Record<StorageRoot | 'database' | 'total', number>> {
  const sizes = await Promise.all(ROOTS.map((r) => dirSize(lib.paths.dir(r))))
  const out = Object.fromEntries(ROOTS.map((r, i) => [r, sizes[i]!])) as Record<StorageRoot, number>
  let database = 0
  for (const f of [lib.paths.db, lib.paths.wal, lib.paths.shm]) {
    try {
      database += (await fs.stat(f)).size
    } catch {
      // absent
    }
  }
  const total = sizes.reduce((a, b) => a + b, 0) + database
  return { ...out, database, total }
}
