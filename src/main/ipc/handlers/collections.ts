/**
 * Handlers `collections.*` : arbre avec couvertures, création, édition (cycle refusé),
 * suppression (pierres tombales des descendants), réordonnancement, ajout / retrait d'éléments.
 */
import { AppError } from '../../../shared/errors'
import { collectionNode, collectionTree } from '../../dto/collection-node'
import { emitCollectionsChanged, emitItemsChanged } from '../../events'
import { requireLibrary, type LibraryContext } from '../../library/library-context'
import type { DomainHandlers } from '../router'

function colId(lib: LibraryContext, uuid: string): number {
  const id = lib.repos.collections.idByUuid(uuid)
  if (id === undefined) throw new AppError('not_found', 'Collection introuvable.')
  return id
}

function itemIds(lib: LibraryContext, uuids: readonly string[]): number[] {
  const map = lib.repos.items.idsByUuids(uuids)
  return uuids.map((u) => map.get(u)).filter((n): n is number => n !== undefined)
}

function node(lib: LibraryContext, uuid: string) {
  const n = collectionNode(lib, lib.db, uuid)
  if (!n) throw new AppError('not_found', 'Collection introuvable.')
  return n
}

export const collectionsHandlers: DomainHandlers<'collections'> = {
  'collections.tree': () => {
    const lib = requireLibrary()
    return collectionTree(lib, lib.db)
  },

  'collections.create': ({ name, parentUuid, color }) => {
    const lib = requireLibrary()
    const c = lib.repos.collections.create({
      name,
      ...(parentUuid ? { parentId: colId(lib, parentUuid) } : {}),
      ...(color ? { color } : {}),
    })
    emitCollectionsChanged([c.uuid])
    return node(lib, c.uuid)
  },

  'collections.update': ({ uuid, name, color, coverItemUuid, parentUuid, aiExcluded }) => {
    const lib = requireLibrary()
    const id = colId(lib, uuid)
    let coverItemId: number | null | undefined
    if (coverItemUuid !== undefined) {
      coverItemId =
        coverItemUuid === null ? null : (lib.repos.items.getByUuid(coverItemUuid)?.id ?? null)
    }
    lib.repos.collections.update(id, {
      ...(name !== undefined ? { name } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(coverItemId !== undefined ? { coverItemId } : {}),
      ...(parentUuid !== undefined
        ? { parentId: parentUuid === null ? null : colId(lib, parentUuid) }
        : {}),
      ...(aiExcluded !== undefined ? { aiExcluded } : {}),
    })
    emitCollectionsChanged([uuid])
    return node(lib, uuid)
  },

  'collections.delete': ({ uuid, keepChildren }) => {
    const lib = requireLibrary()
    const count = lib.repos.collections.delete(colId(lib, uuid), { keepChildren })
    emitCollectionsChanged([uuid])
    emitItemsChanged([], 'updated')
    return { count }
  },

  'collections.reorder': ({ uuid, beforeUuid }) => {
    const lib = requireLibrary()
    lib.repos.collections.reorder(colId(lib, uuid), beforeUuid ? colId(lib, beforeUuid) : null)
    emitCollectionsChanged([uuid])
  },

  'collections.addItems': ({ collectionUuid, itemUuids }) => {
    const lib = requireLibrary()
    const count = lib.repos.collections.addItems(
      colId(lib, collectionUuid),
      itemIds(lib, itemUuids),
    )
    emitCollectionsChanged([collectionUuid])
    emitItemsChanged(itemUuids, 'updated')
    return { count }
  },

  'collections.removeItems': ({ collectionUuid, itemUuids }) => {
    const lib = requireLibrary()
    const count = lib.repos.collections.removeItems(
      colId(lib, collectionUuid),
      itemIds(lib, itemUuids),
    )
    emitCollectionsChanged([collectionUuid])
    emitItemsChanged(itemUuids, 'updated')
    return { count }
  },

  'collections.markViewed': ({ uuid }) => {
    const lib = requireLibrary()
    lib.repos.collections.markViewed(colId(lib, uuid))
  },
}
