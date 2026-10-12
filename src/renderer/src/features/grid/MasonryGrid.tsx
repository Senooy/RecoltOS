/**
 * `MasonryGrid` : disposition déterministe (`layoutMasonry`), cartes en absolu +
 * `translate`, fenêtrage (recherche binaire, overscan 800 px), posts texte mesurés AVANT le premier
 * rendu (aucun décalage de mise en page), `.reflowing` 300 ms au changement de colonnes, navigation
 * clavier géométrique, `role="list"`, menu contextuel unique, glisser natif. Vue détail :
 * `grid.scrollTo` amène la carte courante en vue avant le FLIP de fermeture, `grid.cascade` fait
 * réapparaître les cartes visibles en fondu échelonné.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react'
import type { ItemCard } from '../../../../shared/dto/items'
import { Menu, isReducedMotion } from '../../components/ui'
import { on } from '../../lib/bus'
import { fr } from '../../i18n/fr'
import { lruSet } from '../../lib/lru'
import { startCardDrag } from '../../lib/dnd'
import { askConfirm } from '../../state/dialogs'
import { useUi } from '../../state/ui'
import { purgeItems } from './actions'
import { PAGE_FOOTER_H, PAGE_RATIO } from './cards/MediaCards'
import { SaveCard, cardKind } from './cards/SaveCard'
import { TweetCard } from './cards/TweetCard'
import {
  columnGeometry,
  layoutMasonry,
  neighbor,
  visibleIndices,
  type MasonryItem,
} from './layoutMasonry'
import { SaveContextMenuContent, type MenuContext } from './SaveContextMenu'
import './grid.css'

export const GRID_GAP = 8
export const GRID_PAD_X = 18
export const OVERSCAN = 800
/** Cascade de réapparition : décalage par carte (ordre de lecture) et durée du fondu. */
export const CASCADE_STEP_MS = 40
export const CASCADE_MS = 240

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

/** Hauteurs mesurées des posts texte, par largeur de colonne (`${uuid}:${colW}`), bornées. */
const tweetHeightCache = new Map<string, number>()
const TWEET_HEIGHT_CACHE_MAX = 20_000

/** Marque de démarrage `grid-painted` déjà émise (une fois par renderer). */
let gridPaintedMarked = false

function useTweetHeights(items: readonly ItemCard[], colW: number) {
  const tweets = useMemo(() => items.filter((i) => i.kind === 'tweet'), [items])
  const key = (u: string) => `${u}:${colW.toFixed(1)}`
  const missing = colW > 0 ? tweets.filter((t) => !tweetHeightCache.has(key(t.uuid))) : []
  const [fontsReady, setFontsReady] = useState(() => document.fonts.status === 'loaded')
  const [version, bump] = useState(0)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const everReady = useRef(false)
  useEffect(() => {
    if (fontsReady) return
    let alive = true
    void document.fonts.ready.then(() => alive && setFontsReady(true))
    return () => {
      alive = false
    }
  }, [fontsReady])
  useEffect(() => {
    const onDone = () => {
      tweetHeightCache.clear()
      bump((n) => n + 1)
    }
    document.fonts.addEventListener('loadingdone', onDone)
    return () => document.fonts.removeEventListener('loadingdone', onDone)
  }, [])
  const missingKey = missing.map((t) => t.uuid).join(',')
  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer || !fontsReady || missingKey === '') return
    for (const el of Array.from(layer.children) as HTMLElement[]) {
      const u = el.dataset.measure
      if (u)
        lruSet(
          tweetHeightCache,
          `${u}:${colW.toFixed(1)}`,
          el.getBoundingClientRect().height,
          TWEET_HEIGHT_CACHE_MAX,
        )
    }
    bump((n) => n + 1)
  }, [missingKey, fontsReady, colW])
  const layer =
    missing.length > 0 && fontsReady ? (
      <div
        ref={layerRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0"
        style={{ visibility: 'hidden', width: colW }}
      >
        {missing.map((t) => (
          <div key={t.uuid} data-measure={t.uuid} style={{ width: colW }}>
            <TweetCard card={t} />
          </div>
        ))}
      </div>
    ) : null
  if (fontsReady && missing.length === 0) everReady.current = true
  // Premier rendu : on attend les mesures (aucun décalage) ; ensuite, un nouveau post s'affiche
  // avec une hauteur provisoire puis se recale dès sa mesure.
  const ready = fontsReady && (missing.length === 0 || everReady.current)
  return { ready, version, layer, height: (u: string) => tweetHeightCache.get(key(u)) }
}

export interface MasonryGridProps {
  items: readonly ItemCard[]
  columns: number
  scrollRef: RefObject<HTMLElement | null>
  context: MenuContext
  collection?: { uuid: string; name: string } | undefined
  onOpen?: (card: ItemCard, list: readonly ItemCard[]) => void
}

export function MasonryGrid({
  items,
  columns,
  scrollRef,
  context,
  collection,
  onOpen,
}: MasonryGridProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const width = useWidth(rootRef)
  const { colW } = columnGeometry({ width, columns, gap: GRID_GAP, padX: GRID_PAD_X })
  const tweets = useTweetHeights(items, colW)
  const selection = useUi((s) => s.selection)
  const selected = useMemo(() => new Set(selection), [selection])

  const layout = useMemo(() => {
    const list: MasonryItem[] = items.map((c) => {
      const k = cardKind(c)
      if (k === 'tweet')
        return { id: c.uuid, measured: tweets.height(c.uuid) ?? 160, placementRatio: 0.5 }
      if (k === 'page') return { id: c.uuid, ratio: PAGE_RATIO, fixedExtra: PAGE_FOOTER_H }
      const ratio = c.width && c.height ? c.height / c.width : 1
      return { id: c.uuid, ratio }
    })
    return layoutMasonry(list, { width, columns, gap: GRID_GAP, padX: GRID_PAD_X })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, width, columns, tweets.ready, tweets.version])

  // Changement de colonnes : réagencement animé (jamais au défilement).
  const [reflowing, setReflowing] = useState(false)
  const prevCols = useRef(columns)
  useEffect(() => {
    if (prevCols.current === columns) return
    prevCols.current = columns
    setReflowing(true)
    const t = setTimeout(() => setReflowing(false), 300)
    return () => clearTimeout(t)
  }, [columns])

  // Fenêtrage : fenêtre visible du conteneur défilant, ramenée au repère de la grille.
  const [view, setView] = useState({ top: 0, bottom: 1200 })
  useEffect(() => {
    const sc = scrollRef.current
    const root = rootRef.current
    if (!sc || !root) return
    let raf = 0
    const update = () => {
      raf = 0
      const offset =
        root.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
      const top = sc.scrollTop - offset
      setView((v) => {
        const next = { top: top - OVERSCAN, bottom: top + sc.clientHeight + OVERSCAN }
        return Math.abs(next.top - v.top) < 60 && Math.abs(next.bottom - v.bottom) < 60 ? v : next
      })
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    sc.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(sc)
    return () => {
      sc.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [scrollRef, layout.height])

  const visible = useMemo(() => visibleIndices(layout, view.top, view.bottom), [layout, view])

  // Démarrage : `grid-painted` une seule fois, à la première image peinte qui
  // contient des cartes (deux rAF : après le rendu de l'image).
  useEffect(() => {
    if (gridPaintedMarked || visible.length === 0) return
    gridPaintedMarked = true
    requestAnimationFrame(() =>
      requestAnimationFrame(() => window.recolt?.perfMark('grid-painted')),
    )
  }, [visible.length])
  const byId = useMemo(() => new Map(items.map((c, i) => [c.uuid, i])), [items])

  // Fermeture du Viewer : la carte courante est amenée en vue (si besoin) avant le FLIP inverse.
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  useEffect(
    () =>
      on('grid.scrollTo', ({ uuid }) => {
        const sc = scrollRef.current
        const root = rootRef.current
        const i = byId.get(uuid)
        const p = i === undefined ? undefined : layoutRef.current.placed[i]
        if (!sc || !root || !p) return
        const offset =
          root.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
        const top = offset + p.y
        if (top >= sc.scrollTop && top + p.h <= sc.scrollTop + sc.clientHeight) return
        sc.scrollTop = Math.max(0, top - Math.max(0, (sc.clientHeight - p.h) / 2))
      }),
    [scrollRef, byId],
  )

  // Cascade : rang de chaque carte visible dans l'ordre de lecture (haut puis gauche).
  const [cascade, setCascade] = useState<{ except: string | null; key: number } | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = on('grid.cascade', ({ except }) => {
      if (isReducedMotion()) return
      setCascade({ except, key: Date.now() })
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setCascade(null), 1400)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [])
  const cascadeRank = useMemo(() => {
    if (!cascade) return null
    const sc = scrollRef.current
    const root = rootRef.current
    let top = view.top + OVERSCAN
    let bottom = view.bottom - OVERSCAN
    if (sc && root) {
      const offset =
        root.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
      top = sc.scrollTop - offset
      bottom = top + sc.clientHeight
    }
    const inView = visible
      .map((i) => layout.placed[i]!)
      .filter((p) => p.y + p.h > top && p.y < bottom)
      .sort((a, b) => a.y - b.y || a.x - b.x)
    return new Map(inView.map((p, rank) => [p.id, rank]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cascade])

  // Sélection : ⌘-clic bascule, Maj-clic étend la plage depuis la dernière ancre.
  const anchor = useRef<string | null>(null)
  const onToggleSelect = useCallback(
    (e: MouseEvent, card: ItemCard) => {
      const ui = useUi.getState()
      if (e.shiftKey && anchor.current && byId.has(anchor.current)) {
        const a = byId.get(anchor.current)!
        const b = byId.get(card.uuid)!
        const [lo, hi] = a < b ? [a, b] : [b, a]
        ui.setSelection([...ui.selection, ...items.slice(lo, hi + 1).map((c) => c.uuid)])
      } else {
        ui.toggleSelected(card.uuid)
        anchor.current = card.uuid
      }
    },
    [byId, items],
  )
  const onActivate = useCallback(
    (_e: MouseEvent | KeyboardEvent, card: ItemCard) => {
      const ui = useUi.getState()
      if (ui.selection.length > 0) {
        ui.toggleSelected(card.uuid)
        return
      }
      onOpen?.(card, items)
    },
    [items, onOpen],
  )
  const onDragStart = useCallback((e: DragEvent<HTMLDivElement>, card: ItemCard) => {
    const ui = useUi.getState()
    const uuids = ui.selection.includes(card.uuid) ? ui.selection : [card.uuid]
    startCardDrag(e, uuids, e.currentTarget.querySelector('img'))
  }, [])
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>, card: ItemCard) => {
      const dirs: Record<string, 'left' | 'right' | 'up' | 'down'> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
      }
      const dir = dirs[e.key]
      if (dir) {
        e.preventDefault()
        const i = byId.get(card.uuid)
        if (i === undefined) return
        const next = layout.placed[neighbor(layout, i, dir)]
        if (!next) return
        const sc = scrollRef.current
        const el = rootRef.current?.querySelector<HTMLElement>(`[data-uuid="${next.id}"]`)
        if (el) el.focus()
        else if (sc) sc.scrollTop = next.y
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        onActivate(e, card)
      }
    },
    [byId, layout, onActivate, scrollRef],
  )

  // Menu contextuel unique : la carte visée est lue sur l'élément cliqué.
  const [menuCards, setMenuCards] = useState<ItemCard[]>([])
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-uuid]')
    const uuid = el?.dataset.uuid
    if (!uuid) {
      e.preventDefault()
      return
    }
    const sel = useUi.getState().selection
    const uuids = sel.includes(uuid) ? sel : [uuid]
    setMenuCards(
      uuids.map((u) => items[byId.get(u) ?? -1]).filter((c): c is ItemCard => c !== undefined),
    )
  }
  const deleteForever = async (uuids: string[]) => {
    const ok = await askConfirm({
      title: fr.confirm.deleteForeverTitle,
      body: fr.confirm.irreversible,
      confirmLabel: fr.confirm.delete,
      danger: true,
    })
    if (ok) await purgeItems(uuids)
  }

  return (
    <Menu.Context.Root>
      <Menu.Context.Trigger asChild>
        <div
          ref={rootRef}
          data-testid="grid"
          role="list"
          aria-label={fr.gridUi.label}
          aria-busy={!tweets.ready}
          className={`masonry relative w-full${reflowing ? ' reflowing' : ''}`}
          style={{ height: tweets.ready ? layout.height : 0 }}
          onContextMenu={onContextMenu}
        >
          {tweets.layer}
          {tweets.ready
            ? visible.map((i) => {
                const p = layout.placed[i]!
                const card = items[i]!
                const rank = cascadeRank?.get(card.uuid)
                const cascading = cascade !== null && card.uuid !== cascade.except
                return (
                  <SaveCard
                    key={card.uuid}
                    card={card}
                    width={p.w}
                    height={p.h}
                    selected={selected.has(card.uuid)}
                    className={cascading ? 'masonry-card cascade-in' : 'masonry-card'}
                    style={{
                      transform: `translate(${p.x}px, ${p.y}px)`,
                      ...(cascading
                        ? {
                            animationDelay: `${(rank ?? 40) * CASCADE_STEP_MS}ms`,
                            animationDuration: `${CASCADE_MS}ms`,
                          }
                        : {}),
                    }}
                    onActivate={onActivate}
                    onToggleSelect={onToggleSelect}
                    onDragStart={onDragStart}
                    onKeyDown={onKeyDown}
                  />
                )
              })
            : null}
        </div>
      </Menu.Context.Trigger>
      {menuCards.length > 0 ? (
        <SaveContextMenuContent
          cards={menuCards}
          context={context}
          collection={collection}
          onDeleteForever={(u) => void deleteForever(u)}
        />
      ) : null}
    </Menu.Context.Root>
  )
}
