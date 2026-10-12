/**
 * Files of an item, main side (`system.*` handlers, native drag). Synchronous reads
 * (better-sqlite3, `fs.statSync`): the drag must call `startDrag` during the IPC event,
 * with no asynchronous round-trip. No `electron` import.
 *
 * Does not cache `db` nor `repos`: the library is re-read on each call (contract).
 */
import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '../../shared/errors'
import type { MediaRow } from '../db/repos/media'
import type { ItemRow } from '../db/repos/items'
import type { LibraryContext } from '../library/library-context'
import { mt } from '../i18n'

export interface ItemWithMedia {
  item: ItemRow
  /** Media by position; the cover first. */
  media: MediaRow[]
}

type Lib = Pick<LibraryContext, 'repos' | 'paths'>

export function loadItem(lib: Lib, uuid: string): ItemWithMedia {
  const item = lib.repos.items.getByUuid(uuid)
  if (!item) throw new AppError('not_found', mt().errors.itemNotFound)
  const media = lib.repos.media.listByItem(item.id)
  const coverIdx = media.findIndex((m) => m.id === item.cover_media_id)
  if (coverIdx > 0) media.unshift(...media.splice(coverIdx, 1))
  return { item, media }
}

/**
 * Absolute path of a relative file if it exists (regular file), otherwise `null`. The file must
 * stay under the library root once symbolic links are resolved: dragging and
 * "Show in Finder" never give a file that leaves the library.
 */
export function existingAbs(lib: Lib, rel: string | null | undefined): string | null {
  if (!rel) return null
  let abs: string
  try {
    abs = lib.paths.abs(rel)
  } catch {
    return null
  }
  try {
    if (!fs.statSync(abs).isFile()) return null
    const real = fs.realpathSync(abs)
    const root = fs.realpathSync(lib.paths.root)
    const inside =
      real === root || real.startsWith(root.endsWith(path.sep) ? root : root + path.sep)
    return inside ? abs : null
  } catch {
    return null
  }
}

/** Local original of a media item (`remote` / `missing`: none). */
export function originalAbs(lib: Lib, m: MediaRow): string | null {
  if (m.status === 'remote' || m.status === 'missing') return null
  return existingAbs(lib, m.file_rel)
}

/**
 * Local originals of an item, cover first ("Show in Finder", "Save as",
 * Quick Look, drag to Finder: the original is given, never a derivative).
 */
export function itemOriginals(lib: Lib, uuid: string): string[] {
  const { media } = loadItem(lib, uuid)
  const seen = new Set<string>()
  for (const m of media) {
    const abs = originalAbs(lib, m)
    if (abs) seen.add(abs)
  }
  return [...seen]
}

/** Original of the cover or `AppError('not_found')` (text post, remote or lost media). */
export function requireCoverOriginal(lib: Lib, uuid: string): string {
  const [first] = itemOriginals(lib, uuid)
  if (!first) throw new AppError('not_found', mt().errors.noLocalFile)
  return first
}

/**
 * Source of an image copy (`system.copyImage`): video → poster (otherwise thumbnail);
 * image → displayable variant (HEIC, PSD…) otherwise original, then large image and thumbnail.
 */
export function copyImageSource(lib: Lib, uuid: string): string {
  const { media } = loadItem(lib, uuid)
  const cover = media[0]
  if (!cover) throw new AppError('not_found', mt().errors.noImage)
  const candidates =
    cover.media_type === 'video'
      ? [cover.poster_rel, cover.thumb_rel, cover.legacy_thumb_rel, cover.large_rel]
      : [
          cover.display_rel,
          cover.status === 'remote' || cover.status === 'missing' ? null : cover.file_rel,
          cover.large_rel,
          cover.thumb_rel,
          cover.legacy_thumb_rel,
        ]
  for (const rel of candidates) {
    const abs = existingAbs(lib, rel)
    if (abs) return abs
  }
  throw new AppError('not_found', mt().errors.noLocalImage)
}

/**
 * Files dragged out for a selection (selection order, no duplicates).
 * Called during `dragstart`: de-duplication via `Set` (O(n)), no `includes` (O(n²)).
 */
export function dragFiles(lib: Lib, uuids: readonly string[]): string[] {
  const out = new Set<string>()
  for (const uuid of uuids) {
    let files: string[]
    try {
      files = itemOriginals(lib, uuid)
    } catch {
      continue
    }
    for (const f of files) out.add(f)
  }
  return [...out]
}
