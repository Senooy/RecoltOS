/**
 * Index complet de la vue en mémoire (DESIGN §3.1) : première page de 120 tout de suite, pages
 * suivantes en arrière-plan (keyset), rechargé (débouncé) à chaque `items.changed` ; l'ancienne liste
 * reste affichée pendant le rechargement (pas de clignotement).
 */
import { useEffect, useRef, useState } from 'react'
import type { ItemCard, ItemsPage } from '../../../../shared/dto/items'
import type { LibraryTab, SortMode } from '../../../../shared/enums'
import { isNotImplemented, rpc, subscribe } from '../../lib/rpc'

export interface LibraryItemsState {
  items: ItemCard[]
  total: number
  loading: boolean
  /** Première page reçue au moins une fois. */
  loaded: boolean
}

export const PAGE_SIZE = 120

export function useLibraryItems(tab: LibraryTab, sort: SortMode, seed: number): LibraryItemsState {
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
          const r: ItemsPage = await rpc('items.list', {
            scope: 'library',
            tab,
            sort,
            seed,
            cursor,
            limit: PAGE_SIZE,
          })
          if (my !== gen.current) return
          all.push(...r.items)
          total = r.total
          cursor = r.nextCursor
          // Première page : affichage immédiat (premier rendu < 800 ms).
          if (page === 0)
            setState({ items: [...all], total, loading: cursor !== null, loaded: true })
          if (!cursor) break
        }
        setState({ items: all, total, loading: false, loaded: true })
      } catch (err) {
        if (my !== gen.current) return
        if (!isNotImplemented(err)) console.warn('[library] liste indisponible', err)
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
        if (tab === 'saved' || tab === 'unsorted') schedule()
      }),
      subscribe('library.switched', schedule),
    ]
    return () => {
      generation.current++
      if (timer) clearTimeout(timer)
      offs.forEach((o) => o())
    }
  }, [tab, sort, seed])
  return state
}
