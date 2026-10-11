/**
 * Bus d'événements interne au renderer (sans IPC) : grille ↔ vue détail (défilement vers une
 * carte, cascade de réapparition), commandes du menu natif relayées au calque ouvert.
 */

export interface BusEvents {
  /** La grille montée fait défiler sa zone jusqu'à la carte (fermeture du Viewer). */
  'grid.scrollTo': { uuid: string }
  /** Les cartes visibles réapparaissent en fondu échelonné, sauf `except` (cible du FLIP). */
  'grid.cascade': { except: string | null }
  /** Commande du menu natif destinée au calque ouvert (zoom, panneau Détails…). */
  'overlay.command': { cmd: string }
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
