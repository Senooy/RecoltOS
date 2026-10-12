/**
 * Initialization of the `library` domain (registry `bootstrap/services.ts`):
 * library manager, opening of the active library, clean shutdown on exit.
 */
import type { Disposer, ServiceContext } from '../bootstrap/context'
import { SLOW_QUERY_MS } from '../db/open'
import { createLibraryManager, type LibraryManager } from './library-manager'

let manager: LibraryManager | null = null

/** Manager initialized by `initLibrary` (handlers `libraries.*`, restore). */
export function getLibraryManager(): LibraryManager | null {
  return manager
}

export function setLibraryManager(m: LibraryManager | null): void {
  manager = m
}

export async function initLibrary(ctx: ServiceContext): Promise<Disposer> {
  const m = createLibraryManager({
    userData: ctx.userData,
    ...(ctx.flags.home ? { home: ctx.flags.home } : {}),
    emit: (event, payload) => ctx.emit(event, payload),
    log: ctx.log,
    ...(ctx.isPackaged
      ? {}
      : {
          onSlowQuery: (sql: string, ms: number) =>
            ctx.log.warn(`[db] slow query (${ms.toFixed(1)} ms > ${SLOW_QUERY_MS}) : ${sql}`),
        }),
  })
  setLibraryManager(m)
  await m.open()
  return async () => {
    await m.close()
    setLibraryManager(null)
  }
}
