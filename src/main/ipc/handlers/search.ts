/**
 * `search.*` handlers: FTS5 search + filters, suggestions (tags,
 * collections), history (8 entries shown, the database keeps more).
 */
import { toItemCard } from '../../dto/item-card'
import { requireLibrary } from '../../library/library-context'
import { runSearch, suggest } from '../../search/search'
import type { DomainHandlers } from '../router'

export const searchHandlers: DomainHandlers<'search'> = {
  'search.query': ({ q, filters, limit }) => {
    const lib = requireLibrary()
    const r = runSearch(lib.db, { q, filters, limit })
    return {
      items: r.rows.map((row) => toItemCard(lib, row)),
      total: r.total,
      noPalette: r.noPalette,
    }
  },
  'search.suggest': ({ q }) => {
    const lib = requireLibrary()
    return suggest(lib.db, q)
  },
  'search.history.list': () => requireLibrary().repos.search.listHistory(8),
  'search.history.add': ({ query }) => {
    requireLibrary().repos.search.addHistory(query)
  },
  'search.history.clear': () => {
    requireLibrary().repos.search.clearHistory()
  },
}
