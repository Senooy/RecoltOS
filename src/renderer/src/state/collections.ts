/**
 * Collection tree on the renderer side: loaded on demand, reloaded on `collections.changed`,
 * `items.changed` (covers and counters) and `library.switched`.
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
      if (!isNotImplemented(err)) console.warn('[collections] could not read', err)
      set({ loaded: true })
    }
  },
}))

/** Flat list (sub-collections indented), in tree order. */
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

/** Subscriptions (to call once per shell). */
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
