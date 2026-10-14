/**
 * Full in-memory index of the view: first page of 120 immediately, pages
 * following in the background (keyset), reloaded (debounced) on each `items.changed`; the previous list
 * stays displayed during the reload (no flicker).
 */
import { useEffect, useRef, useState } from 'react'
import type { ItemCard, ItemsPage } from '../../../../shared/dto/items'
import type { LibraryTab, SortMode } from '../../../../shared/enums'
import type { ItemsListInput } from '../../../../shared/ipc/items'
import { isNotImplemented, rpc, subscribe } from '../../lib/rpc'

export interface LibraryItemsState {
  items: ItemCard[]
  total: number
  loading: boolean
  /** First page received at least once. */
  loaded: boolean
}

export const PAGE_SIZE = 120

export function useLibraryItems(tab: LibraryTab, sort: SortMode, seed: number): LibraryItemsState {
  return useItemsList({ scope: 'library', tab, sort, seed }, tab === 'saved' || tab === 'unsorted')
}

/** Direct members of a collection, also reloaded on `collections.changed`. */
export function useCollectionItems(
  collectionUuid: string,
  sort: SortMode,
  seed: number,
): LibraryItemsState {
  return useItemsList({ scope: 'collection', collectionUuid, sort, seed }, true)
}

type ListBase =
  | { scope: 'library'; tab: LibraryTab; sort: SortMode; seed: number }
  | { scope: 'collection'; collectionUuid: string; sort: SortMode; seed: number }

/** Serialized form of a card (comparison), computed once per card object. */
const signatures = new WeakMap<ItemCard, string>()
function signature(c: ItemCard): string {
  let sig = signatures.get(c)
  if (sig === undefined) {
    sig = JSON.stringify(c)
    signatures.set(c, sig)
  }
  return sig
}

/**
 * Structural sharing between two loads: an unchanged card keeps its previous object (memoized
 * cards and layouts do not re-render), and an unchanged list keeps its previous array.
 */
export function reuseCards(prev: readonly ItemCard[], next: ItemCard[]): ItemCard[] {
  if (prev.length === 0) return next
  const old = new Map(prev.map((c) => [c.uuid, c]))
  let same = prev.length === next.length
  const out = next.map((c, i) => {
    const o = old.get(c.uuid)
    const keep = o !== undefined && signature(o) === signature(c) ? o : c
    if (same && prev[i] !== keep) same = false
    return keep
  })
  return same ? (prev as ItemCard[]) : out
}

/** Full list of a scope, by keyset pages. */
export function useItemsList(base: ListBase, onCollectionsChanged: boolean): LibraryItemsState {
  const key = JSON.stringify(base)
  const [state, setState] = useState<LibraryItemsState>({
    items: [],
    total: 0,
    loading: true,
    loaded: false,
  })
  const gen = useRef(0)
  useEffect(() => {
    const generation = gen
    let timer: ReturnType<typeof setTimeout> | null = null
    let loadedOnce = false
    const load = async () => {
      const my = ++gen.current
      const reloading = loadedOnce
      loadedOnce = true
      if (!reloading) setState((s) => (s.loading ? s : { ...s, loading: true }))
      try {
        let cursor: string | null = null
        const all: ItemCard[] = []
        let total = 0
        for (let page = 0; page < 1000; page++) {
          const input: ItemsListInput = { ...base, cursor, limit: PAGE_SIZE }
          const r: ItemsPage = await rpc('items.list', input)
          if (my !== gen.current) return
          all.push(...r.items)
          total = r.total
          cursor = r.nextCursor
          // First page: immediate display (first render < 800 ms). On a reload, the previous
          // full list stays displayed until the last page (no shrink, no flicker).
          if (page === 0 && !cursor) break
          if (page === 0 && !reloading)
            setState({ items: [...all], total, loading: cursor !== null, loaded: true })
          if (!cursor) break
        }
        setState((s) => {
          const items = reuseCards(s.items, all)
          return items === s.items && s.total === total && !s.loading && s.loaded
            ? s
            : { items, total, loading: false, loaded: true }
        })
      } catch (err) {
        if (my !== gen.current) return
        if (!isNotImplemented(err)) console.warn('[items] list unavailable', err)
        setState((s) => ({ ...s, loading: false, loaded: true }))
      }
    }
    void load()
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void load(), 250)
    }
    const offs = [
      subscribe('items.changed', schedule),
      subscribe('collections.changed', () => {
        if (onCollectionsChanged) schedule()
      }),
      subscribe('library.switched', schedule),
    ]
    return () => {
      generation.current++
      if (timer) clearTimeout(timer)
      offs.forEach((o) => o())
    }
    // `key` summarizes `base` (object recreated on each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, onCollectionsChanged])
  return state
}
