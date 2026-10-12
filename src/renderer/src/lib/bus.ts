/**
 * Internal event bus of the renderer (no IPC): grid ↔ detail view (scroll to a
 * card, staggered fade-in cascade), native menu commands relayed to the open layer.
 */

export interface BusEvents {
  /** The mounted grid scrolls its area to the card (Viewer closed). */
  'grid.scrollTo': { uuid: string }
  /** Visible cards fade back in, staggered, except `except` (FLIP target). */
  'grid.cascade': { except: string | null }
  /** Native menu command for the open layer (zoom, Details panel…). */
  'overlay.command': { cmd: string }
  /** Native menu command for the open space editor (undo, zoom…). */
  'space.command': { cmd: string }
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void

const handlers = new Map<keyof BusEvents, Set<Handler<keyof BusEvents>>>()

export function on<K extends keyof BusEvents>(event: K, h: Handler<K>): () => void {
  let set = handlers.get(event)
  if (!set) {
    set = new Set()
    handlers.set(event, set)
  }
  set.add(h as Handler<keyof BusEvents>)
  return () => {
    set.delete(h as Handler<keyof BusEvents>)
  }
}

export function emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
  for (const h of handlers.get(event) ?? []) (h as Handler<K>)(payload)
}
