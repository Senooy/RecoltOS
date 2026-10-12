/**
 * Emission of business events from the handlers and the queue (`items.changed`,
 * `collections.changed`): also invalidates the tab counter cache. The real emitter
 * (`ServiceContext.emit`) is wired by `jobs/init.ts`; outside Electron, nothing is emitted.
 */
import type { EventName, EventPayload } from '../shared/ipc'
import { invalidatePaletteIndex } from './color/palette-index'
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
  if (lib) {
    invalidateCounts(lib.db)
    invalidatePaletteIndex(lib.db)
  }
  if (uuids.length === 0) return
  emitFn?.('items.changed', { uuids: [...uuids], reason })
}

const collectionsListeners = new Set<(uuids: readonly string[]) => void>()

/** Internal subscription in main (extension menus); returns the unsubscribe function. */
export function onCollectionsChanged(fn: (uuids: readonly string[]) => void): () => void {
  collectionsListeners.add(fn)
  return () => collectionsListeners.delete(fn)
}

export function emitCollectionsChanged(uuids: readonly string[]): void {
  const lib = getActiveLibrary()
  if (lib) invalidateCounts(lib.db)
  emitFn?.('collections.changed', { uuids: [...uuids] })
  for (const fn of collectionsListeners) {
    try {
      fn(uuids)
    } catch {
      // a failing subscriber does not prevent the others
    }
  }
}

/** Emits another business event (`export.progress`…); no effect outside Electron. */
export function emitEvent<E extends EventName>(event: E, payload: EventPayload<E>): void {
  emitFn?.(event, payload)
}
