/**
 * Handlers `tags.*` : liste avec comptes et chips de source virtuelles,
 * ajout / retrait, renommage (`conflict`), suppression, fusion. Noms réservés → `tag_reserved`.
 */
import { AppError } from '../../../shared/errors'
import { sourceChips } from '../../db/queries/counts'
import type { TagRow } from '../../db/repos/tags'
import { emitItemsChanged } from '../../events'
import { requireLibrary, type LibraryContext } from '../../library/library-context'
import type { DomainHandlers } from '../router'

function itemIds(lib: LibraryContext, uuids: readonly string[]): number[] {
  const map = lib.repos.items.idsByUuids(uuids)
  return uuids.map((u) => map.get(u)).filter((n): n is number => n !== undefined)
}

function tagId(lib: LibraryContext, uuid: string): number {
  const t = lib.repos.tags.getByUuid(uuid)
  if (!t) throw new AppError('not_found', 'Tag introuvable.')
  return t.id
}

function info(lib: LibraryContext, t: TagRow) {
  const count = (
    lib.db
      .prepare(
        `SELECT count(*) AS n FROM item_tags it JOIN items i ON i.id = it.item_id
         WHERE it.tag_id = ? AND i.deleted_at IS NULL AND i.hidden_at IS NULL`,
      )
      .get(t.id) as { n: number }
  ).n
  return { uuid: t.uuid, name: t.name, color: t.color, count }
}

export const tagsHandlers: DomainHandlers<'tags'> = {
  'tags.list': () => {
    const lib = requireLibrary()
    return {
      tags: lib.repos.tags
        .listWithCounts()
        .map((t) => ({ uuid: t.uuid, name: t.name, color: t.color, count: t.count })),
      sourceChips: sourceChips(lib.db),
    }
  },
  'tags.add': ({ itemUuids, names }) => {
    const lib = requireLibrary()
    const ids = itemIds(lib, itemUuids)
    const tagIds = lib.repos.tags.addToItems(ids, names, 'user')
    emitItemsChanged(itemUuids, 'updated')
    return { count: tagIds.length }
  },
  'tags.remove': ({ itemUuids, tagUuids }) => {
    const lib = requireLibrary()
    const count = lib.repos.tags.removeFromItems(
      itemIds(lib, itemUuids),
      tagUuids.map((u) => tagId(lib, u)),
    )
    emitItemsChanged(itemUuids, 'updated')
    return { count }
  },
  'tags.create': ({ name }) => {
    const lib = requireLibrary()
    const t = lib.repos.tags.ensure(name)
    const row = lib.repos.tags.getById(t.id)
    if (!row) throw new AppError('not_found', 'Tag introuvable.')
    return info(lib, row)
  },
  'tags.rename': ({ uuid, name }) => {
    const lib = requireLibrary()
    return info(lib, lib.repos.tags.rename(tagId(lib, uuid), name))
  },
  'tags.delete': ({ uuid }) => {
    const lib = requireLibrary()
    lib.repos.tags.delete(tagId(lib, uuid))
  },
  'tags.merge': ({ sourceUuids, targetUuid }) => {
    const lib = requireLibrary()
    const target = tagId(lib, targetUuid)
    lib.repos.tags.merge(
      sourceUuids.map((u) => tagId(lib, u)),
      target,
    )
    const t = lib.repos.tags.getById(target)
    if (!t) throw new AppError('not_found', 'Tag introuvable.')
    return info(lib, t)
  },
}
