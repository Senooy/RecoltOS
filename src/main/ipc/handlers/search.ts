/**
 * Handlers `search.*` (WP-22, ARCHI §4.5) : recherche FTS5 + filtres, suggestions (tags,
 * collections), historique (8 entrées affichées, la base en garde davantage).
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
