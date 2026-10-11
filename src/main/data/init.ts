/**
 * Domaine `data` (WP-24) : instantané quotidien `-daily` (3 s après l'ouverture d'une
 * bibliothèque, hors e2e) puis rétention (ARCHI §7).
 */
import type { Disposer, ServiceContext } from '../bootstrap/context'
import { registerLibraryLifecycle } from '../library/library-context'
import { dailySnapshot } from './snapshots'

export const DAILY_DELAY_MS = 3_000

export function initData(ctx: ServiceContext): Disposer {
  let timer: NodeJS.Timeout | null = null
  const off = registerLibraryLifecycle('data', {
    afterOpen(lib) {
      if (ctx.flags.e2e) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        try {
          dailySnapshot(lib, Date.now())
        } catch (err) {
          ctx.log.warn('[data] instantané quotidien impossible', err)
        }
      }, DAILY_DELAY_MS)
    },
  })
  return () => {
    if (timer) clearTimeout(timer)
    off()
  }
}
