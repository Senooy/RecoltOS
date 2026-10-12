/**
 * Articulation avec l'import GatherOS : l'importeur a déjà pré-rempli
 * `sync_items` et `sync_dismissed` et normalisé les médias. Ici, à la fin de l'import :
 * - backfill programmé pour chaque plateforme (`backfill_done = 0`, curseur et ancre remis à zéro) ;
 * - les drapeaux `syncX/Instagram/CosmosEnabled` de GatherOS sont NOTÉS (`settings`) pour que
 *   Réglages › Synchronisation propose de réactiver chaque source avec la feuille de confirmation :
 *   jamais d'activation silencieuse (requêtes Instagram).
 */
import type { BridgePlatform } from '../../shared/bridge/constants'
import type { LibraryContext } from '../library/library-context'

export const IMPORTED_FLAGS_KEY = 'sync.importedFlags'

export function prefillAfterImport(
  lib: LibraryContext,
  flags: Partial<Record<BridgePlatform, boolean | null>> | null,
  now: number,
): void {
  lib.db.transaction(() => {
    for (const p of ['x', 'instagram', 'cosmos'] as const) {
      lib.repos.sync.patchState(p, {
        backfillDone: false,
        backfillCursor: null,
        backfillAnchorAt: null,
        backfillPos: 0,
      })
    }
    if (flags) lib.repos.settings.set(IMPORTED_FLAGS_KEY, flags, now)
  })()
}
