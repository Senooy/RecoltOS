/**
 * `rediscover.*` handlers: deck weighted by pages, logged actions,
 * undo ≤ 10 s. Suggested collections = the 3 most recently used.
 */
import { cardRowsByIds } from '../../db/queries/list'
import { toItemCard } from '../../dto/item-card'
import { emitCollectionsChanged, emitItemsChanged } from '../../events'
import { requireLibrary } from '../../library/library-context'
import { rediscover, type RediscoverDeps } from '../../rediscover/service'
import type { DomainHandlers } from '../router'

function deps(): RediscoverDeps {
  const lib = requireLibrary()
  return {
    db: lib.db,
    repos: lib.repos,
    changed: (uuids, reason) => emitItemsChanged(uuids, reason),
    collectionsChanged: (uuids) => emitCollectionsChanged(uuids),
  }
}

export const rediscoverHandlers: DomainHandlers<'rediscover'> = {
  'rediscover.deck': (input) => {
    const lib = requireLibrary()
    const d = rediscover.deck(deps(), input)
    return {
      sessionId: d.sessionId,
      total: d.total,
      items: cardRowsByIds(lib.db, d.ids).map((r) => toItemCard(lib, r)),
      suggestedCollections: d.suggestedCollections,
    }
  },
  'rediscover.act': (input) => {
    rediscover.act(deps(), input)
  },
  'rediscover.undo': () => rediscover.undo(deps()),
}
