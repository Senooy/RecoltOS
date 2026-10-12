/**
 * Fichiers d'un élément, côté main (handlers `system.*`, glisser natif). Lecture synchrone
 * (better-sqlite3, `fs.statSync`) : le glisser doit appeler `startDrag` pendant l'événement IPC,
 * sans aller-retour asynchrone. Pas d'import `electron`.
 *
 * Ne mémorise ni `db` ni `repos` : la bibliothèque est relue à chaque appel (contrat).
 */
import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '../../shared/errors'
import type { MediaRow } from '../db/repos/media'
import type { ItemRow } from '../db/repos/items'
import type { LibraryContext } from '../library/library-context'

export interface ItemWithMedia {
  item: ItemRow
  /** Médias par position ; la couverture en premier. */
  media: MediaRow[]
}

type Lib = Pick<LibraryContext, 'repos' | 'paths'>

export function loadItem(lib: Lib, uuid: string): ItemWithMedia {
  const item = lib.repos.items.getByUuid(uuid)
  if (!item) throw new AppError('not_found', 'Élément introuvable.')
  const media = lib.repos.media.listByItem(item.id)
  const coverIdx = media.findIndex((m) => m.id === item.cover_media_id)
  if (coverIdx > 0) media.unshift(...media.splice(coverIdx, 1))
  return { item, media }
}

/**
 * Chemin absolu d'un fichier relatif s'il existe (fichier ordinaire), sinon `null`. Le fichier doit
 * rester sous la racine de la bibliothèque une fois les liens symboliques résolus : le glisser et
 * « Afficher dans le Finder » ne donnent jamais un fichier qui sort de la bibliothèque.
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

/** Original local d'un média (`remote` / `missing` : aucun). */
export function originalAbs(lib: Lib, m: MediaRow): string | null {
  if (m.status === 'remote' || m.status === 'missing') return null
  return existingAbs(lib, m.file_rel)
}

/**
 * Originaux locaux d'un élément, couverture d'abord (« Afficher dans le Finder », « Enregistrer
 * sous », Quick Look, glisser vers le Finder : on donne l'original, jamais un dérivé).
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

/** Original de la couverture ou `AppError('not_found')` (post texte, média distant ou perdu). */
export function requireCoverOriginal(lib: Lib, uuid: string): string {
  const [first] = itemOriginals(lib, uuid)
  if (!first) throw new AppError('not_found', 'Aucun fichier local pour cet élément.')
  return first
}

/**
 * Source d'une copie d'image (`system.copyImage`) : vidéo → poster (sinon vignette) ;
 * image → variante affichable (HEIC, PSD…) sinon original, puis grande image et vignette.
 */
export function copyImageSource(lib: Lib, uuid: string): string {
  const { media } = loadItem(lib, uuid)
  const cover = media[0]
  if (!cover) throw new AppError('not_found', 'Cet élément n’a pas d’image.')
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
  throw new AppError('not_found', 'Aucune image locale pour cet élément.')
}

/**
 * Fichiers glissés vers l'extérieur pour une sélection (ordre de la sélection, sans doublon).
 * Appelé pendant le `dragstart` : dédoublonnage par `Set` (O(n)), pas de `includes` (O(n²)).
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
