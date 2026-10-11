/**
 * Arbre des collections côté renderer : chargé à la demande, rechargé sur `collections.changed`,
 * `items.changed` (couvertures et compteurs) et `library.switched`.
 */
import { create } from 'zustand'
import type { CollectionNode } from '../../../shared/dto/collections'
import { isNotImplemented, rpc, subscribe } from '../lib/rpc'

export interface CollectionsState {
  tree: CollectionNode[]
  loaded: boolean
  load: () => Promise<void>
}

export const useCollections = create<CollectionsState>()((set) => ({
  tree: [],
  loaded: false,
  async load() {
    try {
      set({ tree: await rpc('collections.tree'), loaded: true })
    } catch (err) {
      if (!isNotImplemented(err)) console.warn('[collections] lecture impossible', err)
      set({ loaded: true })
    }
  },
}))

/** Liste à plat (sous-collections indentées), dans l'ordre de l'arbre. */
export function flattenTree(
  tree: readonly CollectionNode[],
  depth = 0,
): { node: CollectionNode; depth: number }[] {
  return tree.flatMap((n) => [{ node: n, depth }, ...flattenTree(n.children, depth + 1)])
}

let timer: ReturnType<typeof setTimeout> | null = null
const reload = () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void useCollections.getState().load(), 150)
}

/** Abonnements (à appeler une fois par la coque). */
export function followCollections(): () => void {
  const offs = [
    subscribe('collections.changed', reload),
    subscribe('items.changed', (p) => {
      if (p.reason !== 'derived' || useCollections.getState().tree.length > 0) reload()
    }),
    subscribe('library.switched', reload),
  ]
  return () => offs.forEach((o) => o())
}
