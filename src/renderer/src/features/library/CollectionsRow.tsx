/**
 * Rangée de collections : carte « Nouvelle collection » en tirets (création en
 * ligne), cartes 188×181 avec `FanStack` (3 couvertures, posts en `TweetCard cover` réduit à .28),
 * cible de dépôt des cartes de la grille, réordonnancement horizontal (`Reorder`), menu contextuel.
 */
import { Pencil, Plus, Trash, Compass } from 'lucide-react'
import { Reorder } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { CollectionNode } from '../../../../shared/dto/collections'
import type { ItemCard } from '../../../../shared/dto/items'
import { Menu, toast } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { cn } from '../../lib/cn'
import { internalDropTarget } from '../../lib/dnd'
import { mediaSrc } from '../../lib/media-url'
import { RpcError, rpc } from '../../lib/rpc'
import { askConfirm, askName } from '../../state/dialogs'
import { useUi } from '../../state/ui'
import { addToCollection } from '../grid/actions'
import { TweetCard } from '../grid/cards/TweetCard'

const FAN_REST = [
  'translateX(-6px) rotate(-3deg)',
  'translateX(9px) rotate(5deg)',
  'translateX(18px) rotate(10deg)',
]
const FAN_HOVER = [
  'translateX(-6px) translateY(-3px) rotate(-3deg)',
  'translateX(13px) rotate(7deg)',
  'translateX(26px) rotate(14deg)',
]

/** Couverture d'une pile (image, affiche ou post réduit) ; `tweetScale` suit la taille du cadre. */
export function Cover({ card, tweetScale = 0.28 }: { card: ItemCard; tweetScale?: number }) {
  if (card.kind === 'tweet') {
    return (
      <div className="h-full w-full overflow-hidden bg-surface">
        <TweetCard
          card={card}
          variant="cover"
          style={{ transform: `scale(${tweetScale})`, transformOrigin: 'top left' }}
        />
      </div>
    )
  }
  const src = mediaSrc(card.thumbUrl ?? card.posterUrl)
  return src ? (
    <img
      src={src}
      alt=""
      draggable={false}
      decoding="async"
      crossOrigin="anonymous"
      className="h-full w-full object-cover"
    />
  ) : (
    <div className="h-full w-full" style={{ background: card.dominant ?? 'var(--skeleton)' }} />
  )
}

export function FanStack({ covers, open }: { covers: readonly ItemCard[]; open: boolean }) {
  const shown = covers.slice(0, 3)
  return (
    <div className="pointer-events-none absolute left-1/2 top-[17px] h-[112px] w-[110px] -translate-x-1/2 translate-x-[calc(-50%+4px)]">
      {shown
        .map((c, i) => ({ c, i }))
        .reverse()
        .map(({ c, i }) => (
          <div
            key={c.uuid}
            className="absolute left-[13px] top-1 h-[104px] w-[84px] overflow-hidden rounded-sm border-[1.5px] border-[rgba(255,255,255,.9)]"
            style={{
              transform: (open ? FAN_HOVER : FAN_REST)[i],
              transition: 'transform 260ms var(--ease-out)',
              boxShadow: 'var(--shadow-stack)',
            }}
          >
            <Cover card={c} />
          </div>
        ))}
    </div>
  )
}

export function CollectionCard({ node, dragging }: { node: CollectionNode; dragging: boolean }) {
  const [hover, setHover] = useState(false)
  const [target, setTarget] = useState(false)
  const navigate = useUi((s) => s.navigate)
  const drop = internalDropTarget(
    (uuids) => void addToCollection({ uuid: node.uuid, name: node.name }, uuids),
    setTarget,
  )
  const rename = async () => {
    const name = await askName({
      title: fr.collection.rename,
      initial: node.name,
      confirmLabel: fr.shell.rename,
    })
    if (!name || name === node.name) return
    try {
      await rpc('collections.update', { uuid: node.uuid, name })
    } catch (err) {
      toast(err instanceof RpcError ? err.message : fr.errors.generic)
    }
  }
  const remove = async () => {
    const children = node.children.length
    const ok = await askConfirm({
      title: fr.collection.deleteConfirmTitle(node.name),
      body: children > 0 ? fr.collection.deleteChildren(children) : fr.collection.deleteConfirmBody,
      confirmLabel: fr.confirm.delete,
      danger: true,
    })
    if (!ok) return
    try {
      await rpc('collections.delete', { uuid: node.uuid, keepChildren: false })
    } catch (err) {
      toast(err instanceof RpcError ? err.message : fr.errors.generic)
    }
  }
  return (
    <Menu.Context.Root>
      <Menu.Context.Trigger asChild>
        <button
          type="button"
          data-testid="collection-card"
          data-uuid={node.uuid}
          className={cn(
            'relative block h-[181px] w-[188px] shrink-0 overflow-hidden rounded-lg border text-left transition-[background-color,box-shadow] duration-150',
            target ? 'border-accent bg-surface' : 'border-border bg-bg hover:bg-surface',
          )}
          style={{ boxShadow: hover || target ? 'var(--shadow-card-hover)' : undefined }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={() => {
            if (!dragging) navigate({ name: 'collection', uuid: node.uuid })
          }}
          {...drop}
        >
          <FanStack covers={node.covers} open={hover || target} />
          <span className="absolute bottom-[27px] left-4 right-3 truncate text-ui font-semibold leading-[18px] text-fg">
            {node.name}
          </span>
          <span className="absolute bottom-[10px] left-4 text-caption text-fg-faint">
            {fr.count.items(node.count)}
          </span>
        </button>
      </Menu.Context.Trigger>
      <Menu.Context.Content>
        <Menu.Context.Item icon={<Pencil />} onSelect={() => void rename()}>
          {fr.collection.rename}
        </Menu.Context.Item>
        <Menu.Context.Item icon={<Compass />} onSelect={() => toast(fr.shell.unavailable)}>
          {fr.collection.rediscoverThis}
        </Menu.Context.Item>
        <Menu.Context.Item tone="danger" icon={<Trash />} onSelect={() => void remove()}>
          {fr.collection.delete}
        </Menu.Context.Item>
      </Menu.Context.Content>
    </Menu.Context.Root>
  )
}

export function NewCollectionCard() {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])
  const commit = async () => {
    const n = name.trim()
    setEditing(false)
    setName('')
    if (!n) return
    try {
      await rpc('collections.create', { name: n })
    } catch (err) {
      toast(err instanceof RpcError ? err.message : fr.errors.generic)
    }
  }
  return (
    <div
      data-testid="new-collection-card"
      role="button"
      tabIndex={0}
      className="group relative h-[181px] w-[188px] shrink-0 cursor-default rounded-lg border border-dashed border-[var(--border-dashed)] transition-colors hover:border-border-strong hover:bg-bg-sunken"
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (!editing && (e.key === 'Enter' || e.key === ' ')) setEditing(true)
      }}
    >
      <Plus
        size={22}
        strokeWidth={1.5}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-fg-subtle"
      />
      {editing ? (
        <input
          ref={inputRef}
          data-testid="new-collection-input"
          className="absolute bottom-[16px] left-3 right-3 h-7 rounded-sm border border-border bg-bg px-2 text-small outline-none"
          placeholder={fr.libraryUi.newCollectionPlaceholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') void commit()
            if (e.key === 'Escape') {
              setEditing(false)
              setName('')
            }
          }}
          onBlur={() => void commit()}
        />
      ) : (
        <span className="absolute bottom-[13px] left-4 text-small text-fg-faint">
          {fr.collection.new}
        </span>
      )}
    </div>
  )
}

export function CollectionsRow({ collections }: { collections: readonly CollectionNode[] }) {
  const [order, setOrder] = useState<string[]>(() => collections.map((c) => c.uuid))
  const [dragging, setDragging] = useState(false)
  useEffect(() => setOrder(collections.map((c) => c.uuid)), [collections])
  const byUuid = new Map(collections.map((c) => [c.uuid, c]))
  const commitOrder = (moved: string) => {
    const i = order.indexOf(moved)
    const before = order[i + 1] ?? null
    void rpc('collections.reorder', { uuid: moved, beforeUuid: before }).catch(() => undefined)
  }
  return (
    <div
      data-testid="collections-row"
      aria-label={fr.libraryUi.collectionsLabel}
      className="no-scrollbar flex gap-3 overflow-x-auto px-[18px] pt-[18px]"
    >
      <NewCollectionCard />
      <Reorder.Group axis="x" values={order} onReorder={setOrder} className="flex gap-3" as="div">
        {order.map((uuid) => {
          const node = byUuid.get(uuid)
          if (!node) return null
          return (
            <Reorder.Item
              key={uuid}
              value={uuid}
              as="div"
              className="shrink-0"
              onDragStart={() => setDragging(true)}
              onDragEnd={() => {
                commitOrder(uuid)
                setTimeout(() => setDragging(false), 0)
              }}
            >
              <CollectionCard node={node} dragging={dragging} />
            </Reorder.Item>
          )
        })}
      </Reorder.Group>
      <div className="w-[6px] shrink-0" />
    </div>
  )
}
