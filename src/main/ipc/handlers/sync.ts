/**
 * `sync.*` handlers: state, toggles, "Sync now", "Resync everything",
 * log, items recovered by the backfill. Without a coordinator (bridge stopped,
 * e2e without `RECOLTOS_BRIDGE`), the state stays readable from the database and the actions have no effect.
 */
import { BRIDGE_PLATFORMS } from '../../../shared/bridge/constants'
import type { SyncStatus } from '../../../shared/dto/sync'
import { cardRowsByUuid } from '../../db/queries/list'
import { toItemCard } from '../../dto/item-card'
import { getActiveLibrary } from '../../library/library-context'
import { getSyncCoordinator } from '../../sync/init'
import type { DomainHandlers } from '../router'

/** Minimal state without a coordinator (reads `sync_state`). */
function offlineStatus(): SyncStatus {
  const lib = getActiveLibrary()
  return {
    sources: BRIDGE_PLATFORMS.map((p) => {
      const st = lib?.repos.sync.getState(p)
      return {
        source: p,
        enabled: !!st?.enabled,
        allowBackgroundTab: !!st?.allow_background_tab,
        accountHandle: st?.account_handle ?? null,
        status: 'no_browser' as const,
        detail: 'browser_closed' as const,
        lastRunAt: st?.last_run_at ?? null,
        lastSuccessAt: st?.last_success_at ?? null,
        lastNewCount: st?.last_new_count ?? 0,
        lastError: st?.last_error ?? null,
        totalSynced: st?.total_synced ?? 0,
        backfillDone: !!st?.backfill_done,
        cooldownUntil: st?.cooldown_until ?? null,
        running: null,
        browser: null,
        loggedIn: null,
        recovered: 0,
        importedFlag: null,
        nextRunAt: null,
      }
    }),
    clients: [],
    gatherosConflict: false,
    browserConnected: false,
    bridgeRunning: false,
  }
}

export const syncHandlers: DomainHandlers<'sync'> = {
  'sync.getStatus': () => getSyncCoordinator()?.status() ?? offlineStatus(),
  'sync.setEnabled': ({ source, on }) => {
    const c = getSyncCoordinator()
    if (c) c.setEnabled(source, on)
    else getActiveLibrary()?.repos.sync.patchState(source, { enabled: on })
  },
  'sync.setAllowBackgroundTab': ({ source, on }) => {
    const c = getSyncCoordinator()
    if (c) c.setAllowBackgroundTab(source, on)
    else getActiveLibrary()?.repos.sync.patchState(source, { allowBackgroundTab: on })
  },
  'sync.runNow': ({ source }) => {
    getSyncCoordinator()?.runNow(source)
  },
  'sync.resyncAll': ({ source }) => {
    getSyncCoordinator()?.resyncAll(source)
  },
  'sync.getRuns': ({ source, limit }) => getSyncCoordinator()?.runHistory(source, limit) ?? [],
  'sync.recovered': ({ source }) => {
    const lib = getActiveLibrary()
    const uuids = getSyncCoordinator()?.recoveredUuids(source) ?? []
    if (!lib || !uuids.length) return { items: [] }
    const order = new Map(uuids.map((u, i) => [u, i]))
    const items = cardRowsByUuid(lib.db, uuids.slice(0, 500))
      .map((r) => toItemCard(lib, r))
      .sort((a, b) => (order.get(a.uuid) ?? 0) - (order.get(b.uuid) ?? 0))
    return { items }
  },
  'sync.ackRecovered': ({ source }) => {
    getSyncCoordinator()?.ackRecovered(source)
  },
  'sync.clearImportedFlag': ({ source }) => {
    getSyncCoordinator()?.clearImportedFlag(source)
  },
}
