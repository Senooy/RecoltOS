/**
 * Library drawer: floating card on the right (inset 12 px, 340 px,
 * radius 16, modal shadow), search, All / one collection selector, 2-column masonry,
 * ✓ badge on items already present. Drag to the canvas (`application/x-recoltos-items`,
 * multi-selection ⌘/⇧-click), double-click = add at the center of the view.
 */
import { Check, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { ItemCard } from '../../../../../../shared/dto/items'
import { tr } from '../../../../i18n'
import { cn } from '../../../../lib/cn'
import { lruSet } from '../../../../lib/lru'
import { cardThumbSrc } from '../../../../lib/media-url'
import { rpc } from '../../../../lib/rpc'
import { flattenTree, useCollections } from '../../../../state/collections'
import { cardKind } from '../../../grid/cards/SaveCard'
import { addItemsAt } from '../actions'
import { useSpace } from '../store/spaceStore'

export const ITEMS_MIME = 'application/x-recoltos-items'
const COL_W = 150
const GAP = 8

/** Cards loaded by the drawer (drag → canvas without a new IPC round trip), bounded. */
const cache = new Map<string, ItemCard>()
const CACHE_MAX = 2_000
export const cachedCards = (): ReadonlyMap<string, ItemCard> => cache

function heightOf(c: ItemCard): number {
  const k = cardKind(c)
  if (k === 'tweet') return 120
  if (k === 'page') return Math.round(COL_W * 0.6) + 36
  if (!c.width || !c.height) return COL_W
  return Math.round(Math.min(2, Math.max(0.4, c.height / c.width)) * COL_W)
}

function DrawerCard({
  card,
  present,
  selected,
  onClick,
  onDragStart,
  onDoubleClick,
}: {
  card: ItemCard
  present: boolean
  selected: boolean
  onClick: (e: React.MouseEvent) => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
}) {
  const src = cardThumbSrc(card)
  const h = heightOf(card)
  const k = cardKind(card)
  return (
    <div
      role="listitem"
      draggable
      data-testid="drawer-card"
      data-uuid={card.uuid}
      data-present={present ? '1' : '0'}
      aria-selected={selected}
      className={cn(
        'relative cursor-grab overflow-hidden rounded-md',
        selected && 'ring-2 ring-[var(--sp-select)]',
      )}
      style={{ height: h, background: card.dominant ?? 'var(--skeleton)' }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragStart={onDragStart}
    >
      {k === 'tweet' || !src ? (
        <div className="h-full w-full border border-border-subtle bg-surface p-2 text-[11px] leading-[15px] text-fg-muted">
          <div className="mb-1 truncate font-medium text-fg">
            {card.post?.author.name ?? card.title ?? ''}
          </div>
          <div className="line-clamp-5">{card.post?.text ?? card.title ?? ''}</div>
        </div>
      ) : (
        <img
          src={src}
          alt=""
          draggable={false}
          crossOrigin="anonymous"
          loading="lazy"
          className="h-full w-full object-cover"
        />
      )}
      {present ? (
        <span
          aria-label={tr.spacesUi.inSpace}
          className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--sp-select)] text-white"
        >
          <Check size={12} strokeWidth={3} />
        </span>
      ) : null}
    </div>
  )
}

export function LibraryDrawer({ spaceUuid }: { spaceUuid: string }) {
  const [q, setQ] = useState('')
  const [collection, setCollection] = useState<string>('')
  const [items, setItems] = useState<ItemCard[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const tree = useCollections((s) => s.tree)
  const flat = useMemo(() => flattenTree(tree), [tree])
  const nodes = useSpace((s) => s.nodes)
  const present = useMemo(() => {
    const set = new Set<string>()
    for (const n of Object.values(nodes)) if (n.type === 'item' && n.itemUuid) set.add(n.itemUuid)
    return set
  }, [nodes])
  const seq = useRef(0)

  useEffect(() => {
    const id = ++seq.current
    const t = setTimeout(
      () => {
        const run = async () => {
          const query = q.trim()
          const filters = collection ? { collectionUuid: collection } : undefined
          const r = query
            ? await rpc('search.query', { q: query, limit: 200, ...(filters ? { filters } : {}) })
            : collection
              ? await rpc('items.list', {
                  scope: 'collection',
                  collectionUuid: collection,
                  limit: 200,
                })
              : await rpc('items.list', { scope: 'library', tab: 'all', limit: 200 })
          if (id !== seq.current) return
          for (const c of r.items) lruSet(cache, c.uuid, c, CACHE_MAX)
          setItems(r.items)
        }
        void run().catch(() => {
          if (id === seq.current) setItems([])
        })
      },
      q ? 180 : 0,
    )
    return () => clearTimeout(t)
  }, [q, collection, spaceUuid])

  const columns = useMemo(() => {
    const cols: ItemCard[][] = [[], []]
    const h = [0, 0]
    for (const c of items) {
      const i = h[0]! <= h[1]! ? 0 : 1
      cols[i]!.push(c)
      h[i]! += heightOf(c) + GAP
    }
    return cols
  }, [items])

  const toggle = (e: React.MouseEvent, uuid: string) => {
    if (e.metaKey || e.shiftKey) {
      setSelected((s) => (s.includes(uuid) ? s.filter((x) => x !== uuid) : [...s, uuid]))
    } else setSelected([uuid])
  }

  return (
    <aside
      data-testid="library-drawer"
      aria-label={tr.spacesUi.drawer}
      className="sp-drawer absolute bottom-3 right-3 top-3 z-30 flex w-[340px] flex-col overflow-hidden"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <div className="flex h-8 flex-1 items-center gap-2 rounded-full border border-border bg-bg px-3">
          <Search size={14} strokeWidth={1.75} className="text-fg-faint" />
          <input
            data-testid="drawer-search"
            aria-label={tr.spacesUi.drawerSearch}
            placeholder={tr.spacesUi.drawerSearch}
            className="min-w-0 flex-1 bg-transparent text-small outline-none placeholder:text-fg-faint"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <button
          type="button"
          aria-label={tr.spacesUi.drawerClose}
          data-testid="drawer-close"
          className="flex h-8 w-8 items-center justify-center rounded-full text-fg-subtle hover:bg-[var(--hover)]"
          onClick={() => useSpace.setState({ drawerOpen: false })}
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>
      <div className="px-3 pb-2">
        <select
          data-testid="drawer-collection"
          aria-label={tr.nav.collections}
          className="h-8 w-full rounded-full border border-border bg-bg px-3 text-small text-fg outline-none"
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
        >
          <option value="">{tr.spacesUi.drawerAll}</option>
          {flat.map((f) => (
            <option key={f.node.uuid} value={f.node.uuid}>
              {'  '.repeat(f.depth)}
              {f.node.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" role="list">
        {items.length === 0 ? (
          <div className="pt-10 text-center text-small text-fg-faint">
            {tr.spacesUi.drawerEmpty}
          </div>
        ) : (
          <div className="flex gap-2">
            {columns.map((col, i) => (
              <div key={i} className="flex min-w-0 flex-1 flex-col gap-2">
                {col.map((c) => (
                  <DrawerCard
                    key={c.uuid}
                    card={c}
                    present={present.has(c.uuid)}
                    selected={selected.includes(c.uuid)}
                    onClick={(e) => toggle(e, c.uuid)}
                    onDoubleClick={() => addItemsAt([c])}
                    onDragStart={(e) => {
                      const uuids = selected.includes(c.uuid) ? selected : [c.uuid]
                      e.dataTransfer.setData(ITEMS_MIME, JSON.stringify(uuids))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
