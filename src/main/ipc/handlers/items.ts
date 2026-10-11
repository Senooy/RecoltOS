/**
 * Handlers `items.*` (WP-12, ARCHI §7) : listes keyset, compteurs en cache, détail, édition,
 * corbeille, purge (lots de 500, job `purge.files` dans la transaction), masquage, vues débouncées.
 */
import { AppError } from '../../../shared/errors'
import { tabCounts } from '../../db/queries/counts'
import { cardRowsByUuid, listItems, recentlyViewed } from '../../db/queries/list'
import { chunks } from '../../db/repos/util'
import { toItemCard } from '../../dto/item-card'
import { toItemDetail } from '../../dto/item-detail'
import { emitItemsChanged } from '../../events'
import { getJobQueue } from '../../jobs/runtime'
import { requireLibrary, type LibraryContext } from '../../library/library-context'
import type { DomainHandlers } from '../router'

function ids(lib: LibraryContext, uuids: readonly string[]): number[] {
  const map = lib.repos.items.idsByUuids(uuids)
  return uuids.map((u) => map.get(u)).filter((n): n is number => n !== undefined)
}

function purge(lib: LibraryContext, itemIds: number[]): number {
  if (itemIds.length === 0) return 0
  const uuids = (
    lib.db
      .prepare('SELECT uuid FROM items WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(itemIds)) as {
      uuid: string
    }[]
  ).map((r) => r.uuid)
  let n = 0
  for (const part of chunks(itemIds, 500)) n += lib.repos.items.purge(part, 'rm').purged
  getJobQueue()?.kick()
  emitItemsChanged(uuids, 'purged')
  return n
}

/** `items.markViewed` débouncé à 1 s par élément (ARCHI §7). */
const viewTimers = new Map<string, NodeJS.Timeout>()
export const MARK_VIEWED_DEBOUNCE_MS = 1_000

export const itemsHandlers: DomainHandlers<'items'> = {
  'items.list': (input) => {
    const lib = requireLibrary()
    const r = listItems(lib.db, input)
    return {
      items: r.rows.map((row) => toItemCard(lib, row)),
      nextCursor: r.nextCursor,
      total: r.total,
    }
  },

  'items.counts': () => tabCounts(requireLibrary().db),

  'items.get': ({ uuid }) => {
    const lib = requireLibrary()
    return toItemDetail(lib, lib.db, uuid)
  },

  'items.update': ({ uuid, patch }) => {
    const lib = requireLibrary()
    const item = lib.repos.items.getByUuid(uuid)
    if (!item) throw new AppError('not_found', 'Élément introuvable.')
    lib.repos.items.update(item.id, {
      ...(patch.title !== undefined
        ? { title: patch.title?.trim() || null, titleSource: 'user' as const }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.sourceUrl !== undefined ? { sourceUrl: patch.sourceUrl } : {}),
    })
    emitItemsChanged([uuid], 'updated')
    return toItemDetail(lib, lib.db, uuid)
  },

  'items.trash': ({ uuids }) => {
    const lib = requireLibrary()
    const count = lib.repos.items.trash(ids(lib, uuids))
    emitItemsChanged(uuids, 'trashed')
    return { count }
  },

  'items.restore': ({ uuids }) => {
    const lib = requireLibrary()
    const count = lib.repos.items.restore(ids(lib, uuids))
    emitItemsChanged(uuids, 'restored')
    return { count }
  },

  'items.purge': ({ uuids }) => {
    const lib = requireLibrary()
    return { count: purge(lib, ids(lib, uuids)) }
  },

  'items.emptyTrash': () => {
    const lib = requireLibrary()
    const trashed = (
      lib.db.prepare('SELECT id FROM items WHERE deleted_at IS NOT NULL ORDER BY id').all() as {
        id: number
      }[]
    ).map((r) => r.id)
    return { count: purge(lib, trashed) }
  },

  'items.setHidden': ({ uuids, hidden }) => {
    const lib = requireLibrary()
    const count = lib.repos.items.setHidden(ids(lib, uuids), hidden)
    emitItemsChanged(uuids, hidden ? 'hidden' : 'updated')
    return { count }
  },

  'items.setAiExcluded': ({ uuids, excluded }) => {
    const lib = requireLibrary()
    const count = lib.db
      .prepare('UPDATE items SET ai_excluded = ? WHERE id IN (SELECT value FROM json_each(?))')
      .run(excluded ? 1 : 0, JSON.stringify(ids(lib, uuids))).changes
    emitItemsChanged(uuids, 'updated')
    return { count }
  },

  'items.markViewed': ({ uuid }) => {
    const prev = viewTimers.get(uuid)
    if (prev) clearTimeout(prev)
    const t = setTimeout(() => {
      viewTimers.delete(uuid)
      const lib = requireLibrary()
      const item = lib.repos.items.getByUuid(uuid)
      if (item) lib.repos.items.markViewed(item.id)
    }, MARK_VIEWED_DEBOUNCE_MS)
    t.unref?.()
    viewTimers.set(uuid, t)
  },

  'items.recentlyViewed': ({ limit }) => {
    const lib = requireLibrary()
    return recentlyViewed(lib.db, limit).map((r) => toItemCard(lib, r))
  },
}

export { cardRowsByUuid }
