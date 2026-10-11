/**
 * Domaine Spaces côté main (SPACES §1.2, §1.6.2, §1.7 ; PLAN §4.2) : liste avec aperçu DOM
 * (20 premiers nœuds), document complet, `applyBatch` atomique, duplication, ajout d'éléments en
 * grille à droite du contenu. Erreurs : `validation` (non réessayable), `busy`, `io`,
 * `limit_exceeded`, `not_found`. Pas d'import `electron` : testable sous Node.
 */
import { existsSync } from 'node:fs'
import type { ItemCard } from '../../shared/dto/items'
import type { SpaceDoc, SpaceSummary } from '../../shared/dto/spaces'
import { SPACE_PREVIEW_NODES } from '../../shared/dto/spaces'
import { AppError } from '../../shared/errors'
import { newUuid } from '../../shared/ids'
import type { ApplyBatchInput } from '../../shared/ipc/spaces'
import type { z } from 'zod'
import { defaultItemStyle } from '../../shared/spaces-defaults'
import { aabb, defaultItemSize, gridPlacement, unionRect } from '../../shared/spaces-geometry'
import {
  Camera,
  MAX_NODES_PER_SPACE,
  SpaceNode,
  normalizeRotation,
  type SpaceBackground,
} from '../../shared/spaces-schema'
import { cardRowsByIds, cardRowsByUuid } from '../db/queries/list'
import type { SpaceNodeInput, SpaceNodeRow, SpaceRow } from '../db/repos/spaces'
import { toItemCard } from '../dto/item-card'
import type { LibraryContext } from '../library/library-context'
import { assetUrlOrNull } from '../protocol/urls'

type Lib = Pick<LibraryContext, 'id' | 'root' | 'db' | 'repos' | 'paths'>
export type ApplyBatch = z.output<typeof ApplyBatchInput>

export const UNTITLED_SPACE = 'Space sans titre'
/** Écart entre le contenu existant et les éléments ajoutés par « Ajouter à un space › ». */
export const ADD_ITEMS_GAP = 80

interface JoinedRow extends SpaceNodeRow {
  item_uuid: string | null
}

/** Convertit une erreur SQLite en `AppError` (codes du contrat). */
export function asSpacesError(err: unknown): AppError {
  if (err instanceof AppError) return err
  const raw = (err as { code?: unknown } | null)?.code
  const code = typeof raw === 'string' ? raw : ''
  const msg = err instanceof Error ? err.message : String(err)
  if (code.startsWith('SQLITE_CONSTRAINT'))
    return new AppError('validation', `Nœud invalide : ${msg}`)
  if (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED')) {
    return new AppError('busy', 'Base occupée, nouvel essai.')
  }
  if (
    code.startsWith('SQLITE_IOERR') ||
    code === 'SQLITE_FULL' ||
    code.startsWith('SQLITE_READONLY')
  ) {
    return new AppError('io', `Écriture impossible : ${msg}`)
  }
  return new AppError('internal', msg)
}

function guard<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    throw asSpacesError(err)
  }
}

/** Vignette dérivée d'un asset : `<sha>.thumb.webp` (image) ou `.thumb.jpg` (poster vidéo). */
export function assetThumbRel(assetRel: string, kind: 'image' | 'video'): string {
  return assetRel.replace(/\.[a-z0-9]+$/, kind === 'video' ? '.thumb.jpg' : '.thumb.webp')
}

function spaceRow(lib: Lib, uuid: string): SpaceRow {
  const row = lib.repos.spaces.getByUuid(uuid)
  if (!row || row.deleted_at !== null) throw new AppError('not_found', 'Space introuvable.')
  return row
}

function parseViewport(v: string): Camera {
  try {
    const r = Camera.safeParse(JSON.parse(v))
    if (r.success) return r.data
  } catch {
    // viewport illisible : défaut
  }
  return { x: 0, y: 0, zoom: 1 }
}

/** Ligne → nœud du contrat (`null` si la ligne est irrécupérable : journalisée par l'appelant). */
export function rowToNode(lib: Pick<Lib, 'id' | 'paths'>, r: JoinedRow): SpaceNode | null {
  let style: unknown
  try {
    style = JSON.parse(r.style)
  } catch {
    return null
  }
  const base = {
    uuid: r.uuid,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    rotation: normalizeRotation(r.rotation),
    z: r.z,
    locked: r.locked === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
  let raw: unknown
  switch (r.type) {
    case 'item':
      raw = { ...base, type: 'item', itemUuid: r.item_uuid, style }
      break
    case 'image': {
      const rel = r.asset_rel
      if (!rel) return null
      const kind = (style as { kind?: unknown } | null)?.kind === 'video' ? 'video' : 'image'
      const thumbRel = assetThumbRel(rel, kind)
      let hasThumb = false
      try {
        hasThumb = existsSync(lib.paths.abs(thumbRel))
      } catch {
        hasThumb = false
      }
      raw = {
        ...base,
        type: 'image',
        assetRel: rel,
        assetUrl: assetUrlOrNull(lib.id, rel),
        assetThumbUrl: hasThumb ? assetUrlOrNull(lib.id, thumbRel) : null,
        style,
      }
      break
    }
    default:
      raw = { ...base, type: r.type, content: r.content ?? '', style }
  }
  const p = SpaceNode.safeParse(raw)
  return p.success ? p.data : null
}

function joinedRows(lib: Lib, spaceId: number, limit?: number): JoinedRow[] {
  return lib.db
    .prepare(
      `SELECT n.*, i.uuid AS item_uuid FROM space_nodes n LEFT JOIN items i ON i.id = n.item_id
       WHERE n.space_id = ? ORDER BY n.z, n.id ${limit ? 'LIMIT ?' : ''}`,
    )
    .all(...(limit ? [spaceId, limit] : [spaceId])) as JoinedRow[]
}

function cardsFor(lib: Lib, rows: readonly JoinedRow[]): Record<string, ItemCard> {
  const ids = [...new Set(rows.map((r) => r.item_id).filter((n): n is number => n !== null))]
  const out: Record<string, ItemCard> = {}
  for (const row of cardRowsByIds(lib.db, ids)) out[row.uuid] = toItemCard(lib, row)
  return out
}

function nodesOf(lib: Lib, rows: readonly JoinedRow[], log?: (m: string) => void): SpaceNode[] {
  const out: SpaceNode[] = []
  for (const r of rows) {
    const n = rowToNode(lib, r)
    if (n) out.push(n)
    else log?.(`[spaces] nœud ${r.uuid} illisible, ignoré`)
  }
  return out
}

export function listSpaces(lib: Lib): SpaceSummary[] {
  const counts = new Map(
    (
      lib.db.prepare('SELECT space_id, count(*) AS n FROM space_nodes GROUP BY space_id').all() as {
        space_id: number
        n: number
      }[]
    ).map((r) => [r.space_id, r.n]),
  )
  return lib.repos.spaces.list().map((s) => {
    const rows = joinedRows(lib, s.id, SPACE_PREVIEW_NODES)
    return {
      uuid: s.uuid,
      name: s.name,
      background: s.background,
      nodeCount: counts.get(s.id) ?? 0,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      preview: { nodes: nodesOf(lib, rows), items: cardsFor(lib, rows) },
    }
  })
}

export function createSpace(lib: Lib, name?: string, at: number = Date.now()): { uuid: string } {
  return guard(() => ({ uuid: lib.repos.spaces.create({ name: name ?? '' }, at).uuid }))
}

export function getSpace(lib: Lib, uuid: string, log?: (m: string) => void): SpaceDoc {
  const s = spaceRow(lib, uuid)
  const rows = joinedRows(lib, s.id)
  return {
    space: {
      uuid: s.uuid,
      name: s.name,
      viewport: parseViewport(s.viewport),
      background: s.background,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      viewedAt: s.viewed_at,
    },
    nodes: nodesOf(lib, rows, log),
    items: cardsFor(lib, rows),
  }
}

/** Nœud du contrat → ligne (élément inconnu → `itemId: null`, « Élément supprimé »). */
function toInput(n: SpaceNode, itemIds: Map<string, number>): SpaceNodeInput {
  const common = {
    uuid: n.uuid,
    type: n.type,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    rotation: normalizeRotation(n.rotation),
    z: n.z,
    locked: n.locked,
    style: n.style as Record<string, unknown>,
  }
  switch (n.type) {
    case 'item':
      return { ...common, itemId: n.itemUuid ? (itemIds.get(n.itemUuid) ?? null) : null }
    case 'image':
      return { ...common, assetRel: n.assetRel }
    default:
      return { ...common, content: n.content }
  }
}

export interface ApplyBatchOptions {
  now?: number
}

/**
 * Une transaction : suppressions, upserts, plafond de 20 000 nœuds, nom / fond (qui touchent
 * `updated_at`), viewport (qui ne le touche pas : panoter ne réordonne pas la liste).
 */
export function applyBatch(
  lib: Lib,
  input: ApplyBatch,
  opts: ApplyBatchOptions = {},
): { updatedAt: number } {
  const at = opts.now ?? Date.now()
  const s = spaceRow(lib, input.spaceUuid)
  const itemUuids = input.upsert.flatMap((n) =>
    n.type === 'item' && n.itemUuid ? [n.itemUuid] : [],
  )
  const itemIds =
    itemUuids.length > 0 ? lib.repos.items.idsByUuids(itemUuids) : new Map<string, number>()
  return guard(() =>
    lib.db.transaction(() => {
      if (input.delete.length > 0) lib.repos.spaces.deleteNodes(s.id, input.delete, at)
      if (input.upsert.length > 0) {
        lib.repos.spaces.upsertNodes(
          s.id,
          input.upsert.map((n) => toInput(n, itemIds)),
          at,
        )
        const { n } = lib.db
          .prepare('SELECT count(*) AS n FROM space_nodes WHERE space_id = ?')
          .get(s.id) as { n: number }
        if (n > MAX_NODES_PER_SPACE) {
          throw new AppError('limit_exceeded', 'Ce space a atteint sa taille maximale.')
        }
      }
      if (input.name !== undefined || input.background !== undefined) {
        lib.repos.spaces.update(
          s.id,
          {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.background !== undefined ? { background: input.background } : {}),
          },
          at,
        )
      }
      if (input.viewport) {
        lib.db
          .prepare('UPDATE spaces SET viewport = ?, viewed_at = ? WHERE id = ?')
          .run(JSON.stringify(input.viewport), at, s.id)
      }
      const row = lib.db.prepare('SELECT updated_at FROM spaces WHERE id = ?').get(s.id) as {
        updated_at: number
      }
      return { updatedAt: row.updated_at }
    })(),
  )
}

export function renameSpace(lib: Lib, uuid: string, name: string, at = Date.now()): void {
  const s = spaceRow(lib, uuid)
  guard(() => lib.repos.spaces.update(s.id, { name }, at))
}

export function setBackground(
  lib: Lib,
  uuid: string,
  background: SpaceBackground,
  at = Date.now(),
): void {
  const s = spaceRow(lib, uuid)
  guard(() => lib.repos.spaces.update(s.id, { background }, at))
}

/** Copie l'espace et ses nœuds (nouveaux uuid) ; les assets sont partagés. */
export function duplicateSpace(lib: Lib, uuid: string, at = Date.now()): { uuid: string } {
  const s = spaceRow(lib, uuid)
  return guard(() =>
    lib.db.transaction(() => {
      const copy = lib.repos.spaces.create({ name: `${s.name || UNTITLED_SPACE} (copie)` }, at)
      lib.db
        .prepare('UPDATE spaces SET viewport = ?, background = ? WHERE id = ?')
        .run(s.viewport, s.background, copy.id)
      const rows = lib.repos.spaces.listNodes(s.id)
      lib.repos.spaces.upsertNodes(
        copy.id,
        rows.map((r) => ({
          uuid: newUuid(),
          type: r.type,
          itemId: r.item_id,
          assetRel: r.asset_rel,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          rotation: r.rotation,
          z: r.z,
          locked: r.locked === 1,
          content: r.content,
          style: JSON.parse(r.style) as Record<string, unknown>,
        })),
        at,
      )
      return { uuid: copy.uuid }
    })(),
  )
}

export function deleteSpace(lib: Lib, uuid: string): void {
  const s = spaceRow(lib, uuid)
  guard(() => lib.repos.spaces.delete(s.id))
}

/**
 * « Ajouter à un space › » (SPACES §1.6.2) : grille à `x = bbox.maxX + 80`, `y = bbox.minY`
 * (ou 0,0 si l'espace est vide). Éléments inconnus ignorés.
 */
export function addItems(
  lib: Lib,
  spaceUuid: string,
  itemUuids: readonly string[],
  at = Date.now(),
): { added: number; nodeUuids: string[] } {
  const s = spaceRow(lib, spaceUuid)
  const cards = cardRowsByUuid(lib.db, [...new Set(itemUuids)]).filter((r) => r.deleted_at === null)
  if (cards.length === 0) return { added: 0, nodeUuids: [] }
  const existing = lib.repos.spaces.listNodes(s.id)
  const bbox = unionRect(existing.map((r) => aabb(r)))
  const origin = bbox ? { x: bbox.x + bbox.width + ADD_ITEMS_GAP, y: bbox.y } : { x: 0, y: 0 }
  const sizes = cards.map((c) =>
    defaultItemSize({
      kind: c.kind as 'image' | 'video' | 'tweet' | 'url',
      width: c.m_width,
      height: c.m_height,
    }),
  )
  const pos = gridPlacement(sizes, origin)
  let z = existing.reduce((m, r) => Math.max(m, r.z), -1) + 1
  const nodes: SpaceNodeInput[] = cards.map((c, i) => ({
    uuid: newUuid(),
    type: 'item',
    itemId: c.id,
    x: pos[i]!.x,
    y: pos[i]!.y,
    width: sizes[i]!.width,
    height: sizes[i]!.height,
    rotation: 0,
    z: z++,
    style: defaultItemStyle(),
  }))
  return guard(() =>
    lib.db.transaction(() => {
      if (existing.length + nodes.length > MAX_NODES_PER_SPACE) {
        throw new AppError('limit_exceeded', 'Ce space a atteint sa taille maximale.')
      }
      lib.repos.spaces.upsertNodes(s.id, nodes, at)
      return { added: nodes.length, nodeUuids: nodes.map((n) => n.uuid) }
    })(),
  )
}

/** Uuid des espaces qui contiennent ces éléments (pastille ✓ du tiroir, rafraîchissement). */
export function spaceUuidsOfItems(lib: Lib, itemIds: readonly number[]): string[] {
  if (itemIds.length === 0) return []
  return (
    lib.db
      .prepare(
        `SELECT DISTINCT s.uuid FROM space_nodes n JOIN spaces s ON s.id = n.space_id
         WHERE n.item_id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(itemIds)) as { uuid: string }[]
  ).map((r) => r.uuid)
}
