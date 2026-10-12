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
    const load = async () => {
      const my = ++gen.current
      setState((s) => ({ ...s, loading: true }))
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
          // First page: immediate display (first render < 800 ms).
          if (page === 0)
            setState({ items: [...all], total, loading: cursor !== null, loaded: true })
          if (!cursor) break
        }
        setState({ items: all, total, loading: false, loaded: true })
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
