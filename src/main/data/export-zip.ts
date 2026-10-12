/**
 * Export zip : `manifest.json`, `recolt.db` (`VACUUM INTO`, bibliothèque entière
 * seulement), `items/**` (originaux), `metadata/items.jsonl` (une ligne par élément, lisible hors
 * de RecoltOS), `metadata/collections.json` ; dérivés seulement si `includeDerived`. L'archive est
 * écrite en streaming par le media-worker (yazl, ZIP64 automatique) ; progression en octets.
 * Une collection exporte ses éléments et ceux de ses sous-collections (sans la base).
 * Pas d'import electron (dialogue et `showItemInFolder` : handler).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ZipEntry } from '../../shared/worker-protocol'
import { AppError } from '../../shared/errors'
import { snapshotStamp, vacuumInto } from '../db/migrate'
import type { LibraryContext } from '../library/library-context'

export interface ExportOptions {
  includeDerived: boolean
  collectionUuid?: string | undefined
}

export interface ExportProgress {
  bytesDone: number
  bytesTotal: number
}

export type ZipFn = (
  args: { root: string; entries: ZipEntry[]; out: string },
  onProgress: (p: { done: number; total: number }) => void,
) => Promise<{ bytes: number }>

type Lib = Pick<LibraryContext, 'id' | 'name' | 'db' | 'paths' | 'root'>

const DERIVED_COLUMNS = [
  'thumb_rel',
  'large_rel',
  'poster_rel',
  'preview_rel',
  'display_rel',
] as const

/** Nom proposé : `RecoltOS-<nom>-<AAAA-MM-JJ>.zip`. */
export function defaultExportName(name: string, at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  const safe = name.replace(/[/\\:*?"<>|]+/g, '-').trim() || 'Bibliotheque'
  return `RecoltOS-${safe}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.zip`
}

/** Ids des éléments exportés : tous (base complète) ou la collection et ses descendantes. */
function itemIdsFor(lib: Lib, collectionUuid: string | undefined): number[] | null {
  if (!collectionUuid) return null
  const col = lib.db.prepare('SELECT id FROM collections WHERE uuid = ?').get(collectionUuid) as
    { id: number } | undefined
  if (!col) throw new AppError('not_found', 'Collection introuvable.')
  return (
    lib.db
      .prepare(
        `WITH RECURSIVE d(id) AS (SELECT ? UNION ALL SELECT c.id FROM collections c JOIN d ON c.parent_id = d.id)
         SELECT DISTINCT ci.item_id AS id FROM collection_items ci JOIN items i ON i.id = ci.item_id
         WHERE ci.collection_id IN (SELECT id FROM d) AND i.deleted_at IS NULL`,
      )
      .all(col.id) as { id: number }[]
  ).map((r) => r.id)
}

interface Prepared {
  entries: ZipEntry[]
  sizes: number[]
  tmpDir: string
  counts: { items: number; media: number; collections: number }
}

/** Prépare les fichiers de métadonnées dans `tmp/export-<ts>/` et la liste des entrées. */
export function prepareExport(lib: Lib, opts: ExportOptions, at: number): Prepared {
  const ids = itemIdsFor(lib, opts.collectionUuid)
  const tmpDir = path.join(lib.paths.dir('tmp'), `export-${snapshotStamp(at)}-${process.pid}`)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(tmpDir, 'metadata'), { recursive: true })
  const idFilter = ids ? 'WHERE i.id IN (SELECT value FROM json_each(@ids))' : ''
  const params = ids ? { ids: JSON.stringify(ids) } : {}

  // Métadonnées lisibles hors de RecoltOS.
  const items = lib.db
    .prepare(
      `SELECT i.id, i.uuid, i.kind, i.source, coalesce(i.title, i.ai_title) AS title, i.notes,
              i.source_url AS url, i.post_meta, i.created_at, i.deleted_at, i.hidden_at,
              a.name AS author_name, a.handle AS author_handle,
              (SELECT json_group_array(t.name) FROM item_tags it JOIN tags t ON t.id = it.tag_id
               WHERE it.item_id = i.id) AS tags,
              (SELECT json_group_array(c.name) FROM collection_items ci JOIN collections c
                 ON c.id = ci.collection_id WHERE ci.item_id = i.id) AS collections
       FROM items i LEFT JOIN authors a ON a.id = i.author_id ${idFilter} ORDER BY i.created_at`,
    )
    .all(params) as Record<string, unknown>[]
  const jsonl = items
    .map((r) =>
      JSON.stringify({
        uuid: r.uuid,
        kind: r.kind,
        source: r.source,
        title: r.title,
        notes: r.notes,
        url: r.url,
        tags: JSON.parse((r.tags as string) ?? '[]') as string[],
        collections: JSON.parse((r.collections as string) ?? '[]') as string[],
        author:
          r.author_name || r.author_handle
            ? { name: r.author_name, handle: r.author_handle }
            : null,
        post_meta: r.post_meta ? (JSON.parse(r.post_meta as string) as unknown) : null,
        created_at: r.created_at,
        deleted_at: r.deleted_at,
        hidden_at: r.hidden_at,
      }),
    )
    .join('\n')
  fs.writeFileSync(path.join(tmpDir, 'metadata/items.jsonl'), jsonl ? `${jsonl}\n` : '')

  const collections = lib.db
    .prepare(
      `SELECT c.id, c.uuid, c.name, c.color, p.uuid AS parent_uuid, c.order_index,
              (SELECT json_group_array(i.uuid) FROM collection_items ci JOIN items i ON i.id = ci.item_id
               WHERE ci.collection_id = c.id AND i.deleted_at IS NULL) AS items
       FROM collections c LEFT JOIN collections p ON p.id = c.parent_id ORDER BY c.order_index, c.id`,
    )
    .all() as Record<string, unknown>[]
  const exported = new Set(items.map((r) => r.uuid as string))
  const colOut = collections
    .map((c) => ({
      uuid: c.uuid,
      name: c.name,
      color: c.color,
      parentUuid: c.parent_uuid,
      items: (JSON.parse((c.items as string) ?? '[]') as string[]).filter((u) => exported.has(u)),
    }))
    .filter((c) => !ids || c.items.length > 0 || c.uuid === opts.collectionUuid)
  fs.writeFileSync(
    path.join(tmpDir, 'metadata/collections.json'),
    `${JSON.stringify(colOut, null, 2)}\n`,
  )

  // Fichiers : originaux (+ dérivés).
  const media = lib.db
    .prepare(
      `SELECT m.file_rel, ${DERIVED_COLUMNS.map((c) => `m.${c}`).join(', ')}
       FROM item_media m JOIN items i ON i.id = m.item_id ${idFilter}`,
    )
    .all(params) as Record<string, string | null>[]
  const rels = new Set<string>()
  for (const m of media) {
    if (m.file_rel) rels.add(m.file_rel)
    if (opts.includeDerived) for (const c of DERIVED_COLUMNS) if (m[c]) rels.add(m[c])
  }
  if (opts.includeDerived) {
    const avatars = lib.db
      .prepare(
        "SELECT avatar_rel FROM authors WHERE avatar_rel IS NOT NULL AND avatar_status = 'ok'",
      )
      .all() as { avatar_rel: string }[]
    for (const a of avatars) rels.add(a.avatar_rel)
  }
  const entries: ZipEntry[] = []
  const sizes: number[] = []
  let mediaCount = 0
  for (const rel of [...rels].sort()) {
    let abs: string
    try {
      abs = lib.paths.abs(rel)
      const st = fs.statSync(abs)
      if (!st.isFile()) continue
      sizes.push(st.size)
    } catch {
      continue // fichier absent : signalé par « Vérifier la bibliothèque »
    }
    entries.push({ abs, name: rel })
    mediaCount++
  }

  // Base cohérente (bibliothèque entière seulement).
  if (!ids) {
    const dbFile = path.join(tmpDir, 'recolt.db')
    vacuumInto(lib.db, dbFile)
    entries.unshift({ abs: dbFile, name: 'recolt.db' })
    sizes.unshift(fs.statSync(dbFile).size)
  }
  const counts = { items: items.length, media: mediaCount, collections: colOut.length }
  const manifest = {
    format: 'recoltos-export',
    version: 1,
    exportedAt: at,
    library: { id: lib.id, name: lib.name },
    scope: opts.collectionUuid ? { collectionUuid: opts.collectionUuid } : 'library',
    includeDerived: opts.includeDerived,
    counts,
  }
  const manifestFile = path.join(tmpDir, 'manifest.json')
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
  for (const name of ['metadata/collections.json', 'metadata/items.jsonl']) {
    const abs = path.join(tmpDir, name)
    entries.unshift({ abs, name })
    sizes.unshift(fs.statSync(abs).size)
  }
  entries.unshift({ abs: manifestFile, name: 'manifest.json' })
  sizes.unshift(fs.statSync(manifestFile).size)
  return { entries, sizes, tmpDir, counts }
}

/** Export complet vers `out` ; `zip` = appel au media-worker (`zipLibrary`). */
export async function exportZip(
  lib: Lib,
  opts: ExportOptions,
  out: string,
  zip: ZipFn,
  onProgress: (p: ExportProgress) => void,
  at: number = Date.now(),
): Promise<{ path: string; bytes: number; counts: Prepared['counts'] }> {
  const prepared = prepareExport(lib, opts, at)
  const bytesTotal = prepared.sizes.reduce((a, b) => a + b, 0)
  const cumulative: number[] = []
  prepared.sizes.reduce((acc, s, i) => (cumulative[i] = acc + s), 0)
  onProgress({ bytesDone: 0, bytesTotal })
  try {
    const r = await zip({ root: lib.root, entries: prepared.entries, out }, ({ done }) =>
      onProgress({ bytesDone: cumulative[Math.max(0, done - 1)] ?? bytesTotal, bytesTotal }),
    )
    onProgress({ bytesDone: bytesTotal, bytesTotal })
    return { path: out, bytes: r.bytes, counts: prepared.counts }
  } finally {
    fs.rmSync(prepared.tmpDir, { recursive: true, force: true })
  }
}
