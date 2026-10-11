/**
 * Émission des événements métier depuis les handlers et la file (`items.changed`,
 * `collections.changed`) : invalide aussi le cache des compteurs d'onglets. L'émetteur réel
 * (`ServiceContext.emit`) est branché par `jobs/init.ts` ; hors Electron, rien n'est émis.
 */
import type { EventName, EventPayload } from '../shared/ipc'
import { invalidateCounts } from './db/queries/counts'
import { getActiveLibrary } from './library/library-context'

type Emit = <E extends EventName>(event: E, payload: EventPayload<E>) => void

let emitFn: Emit | null = null

export function setAppEmitter(fn: Emit | null): void {
  emitFn = fn
}

export type ItemsChangedReason = EventPayload<'items.changed'>['reason']

export function emitItemsChanged(uuids: readonly string[], reason: ItemsChangedReason): void {
  const lib = getActiveLibrary()
  if (lib) invalidateCounts(lib.db)
  if (uuids.length === 0) return
  emitFn?.('items.changed', { uuids: [...uuids], reason })
}

export function emitCollectionsChanged(uuids: readonly string[]): void {
  const lib = getActiveLibrary()
  if (lib) invalidateCounts(lib.db)
  emitFn?.('collections.changed', { uuids: [...uuids] })
}
