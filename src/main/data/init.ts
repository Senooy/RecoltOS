/**
 * Domaine `data` (WP-24) : instantané quotidien `-daily` (3 s après l'ouverture d'une
 * bibliothèque, hors e2e) puis rétention (ARCHI §7). La bibliothèque est déjà ouverte quand ce
 * domaine démarre (`library` le précède dans `bootstrap/services.ts`) : l'instantané est donc
 * aussi planifié ici pour la bibliothèque active, pas seulement dans `afterOpen` (bascules).
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
      // Relire la bibliothèque active : ne jamais garder une connexion (library-context).
      const active = getActiveLibrary()
      if (!active || active.id !== lib.id) return
      try {
        dailySnapshot(active, Date.now())
      } catch (err) {
        ctx.log.warn('[data] instantané quotidien impossible', err)
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
