/**
 * `data` domain: daily `-daily` snapshot (3 s after a library is opened, outside e2e), then
 * retention. The library is already open when this domain starts (`library` precedes it in
 * `bootstrap/services.ts`): the snapshot is therefore also scheduled here for the active library,
 * not only in `afterOpen` (switches).
 */
import type { Disposer, ServiceContext } from '../bootstrap/context'
import {
  getActiveLibrary,
  registerLibraryLifecycle,
  type LibraryContext,
} from '../library/library-context'
import { dailySnapshot } from './snapshots'

export const DAILY_DELAY_MS = 3_000

export function initData(ctx: ServiceContext): Disposer {
  let timer: NodeJS.Timeout | null = null
  const schedule = (lib: LibraryContext) => {
    if (ctx.flags.e2e) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      // Re-read the active library: never keep a connection (library-context).
      const active = getActiveLibrary()
      if (!active || active.id !== lib.id) return
      try {
        dailySnapshot(active, Date.now())
      } catch (err) {
        ctx.log.warn('[data] unable to take daily snapshot', err)
      }
    }, DAILY_DELAY_MS)
  }
  const off = registerLibraryLifecycle('data', { afterOpen: schedule })
  const active = getActiveLibrary()
  if (active) schedule(active)
  return () => {
    if (timer) clearTimeout(timer)
    off()
  }
}
