/**
 * Link with the GatherOS import: the importer has already pre-filled
 * `sync_items` and `sync_dismissed` and normalized the media. Here, at the end of the import:
 * - backfill scheduled for each platform (`backfill_done = 0`, cursor and anchor reset to zero);
 * - GatherOS's `syncX/Instagram/CosmosEnabled` flags are NOTED (`settings`) so that
 *   Settings › Synchronization offers to re-enable each source with the confirmation sheet:
 *   never a silent activation (Instagram requests).
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
