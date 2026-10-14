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

/**
 * Structural sharing: every node whose content did not change keeps its previous object (and the
 * whole tree its previous array when nothing changed). The tree is reloaded on every
 * `items.changed` (tagging, views, derivatives…): without this, each reload re-rendered every
 * consumer, including the 3D shelf while it animates.
 */
export function shareTree(prev: CollectionNode[], next: CollectionNode[]): CollectionNode[] {
  const old = new Map(prev.map((n) => [n.uuid, n]))
  let same = prev.length === next.length
  const out = next.map((n, i) => {
    const p = old.get(n.uuid)
    const kept = p && JSON.stringify(p) === JSON.stringify(n) ? p : n
    if (kept !== prev[i]) same = false
    return kept
  })
  return same ? prev : out
}

export const useCollections = create<CollectionsState>()((set, get) => ({
  tree: [],
  loaded: false,
  async load() {
    try {
      const next = await rpc('collections.tree')
      set({ tree: shareTree(get().tree, next), loaded: true })
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
