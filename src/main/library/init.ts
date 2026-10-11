/**
 * Initialisation du domaine `library` (registre `bootstrap/services.ts`, possédé par WP-02) :
 * gestionnaire de bibliothèques, ouverture de la bibliothèque active, fermeture propre à la sortie.
 */
import type { Disposer, ServiceContext } from '../bootstrap/context'
import { SLOW_QUERY_MS } from '../db/open'
import { createLibraryManager, type LibraryManager } from './library-manager'

let manager: LibraryManager | null = null

/** Gestionnaire initialisé par `initLibrary` (handlers `libraries.*`, restauration WP-24). */
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
            ctx.log.warn(`[db] requête lente (${ms.toFixed(1)} ms > ${SLOW_QUERY_MS}) : ${sql}`),
        }),
  })
  setLibraryManager(m)
  await m.open()
  return async () => {
    await m.close()
    setLibraryManager(null)
  }
}
