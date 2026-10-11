/**
 * Vue Collection (DESIGN §3.3, WP-20) : sous-barre (retour Ø30 à x=33, titre éditable en ligne,
 * menu « … », curseur de colonnes et tri persistés par collection), label « DANS CETTE
 * COLLECTION » à y≈180, pilules de sous-collections + « Nouvelle collection » (36 px), masonry à
 * y≈257 avec le menu contextuel « collection ». Ouvrir la collection met à jour son `viewed_at`.
 */
import {
  ChevronLeft,
  Compass,
  Download,
  Ellipsis,
  FolderInput,
  FolderPlus,
  Image as ImageIcon,
  Pencil,
  Plus,
  Trash,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CollectionNode } from '../../../../shared/dto/collections'
import type { ItemCard } from '../../../../shared/dto/items'
import { Button, Dialog, EmptyState, Menu, toast } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { cn } from '../../lib/cn'
import { internalDropTarget } from '../../lib/dnd'
import { cardThumbSrc } from '../../lib/media-url'
import { RpcError, rpc } from '../../lib/rpc'
import { exportZip, soon } from '../../shell/commands'
import { flattenTree, useCollections } from '../../state/collections'
import { askConfirm, askName } from '../../state/dialogs'
import { usePrefs } from '../../state/prefs'
import { clampColumns, useUi } from '../../state/ui'
import { addToCollection } from '../grid/actions'
import { MasonryGrid } from '../grid/MasonryGrid'
import { ColumnSlider } from '../library/ColumnSlider'
import { SortMenu } from '../library/SortMenu'
import { useCollectionItems } from '../library/useLibraryItems'
import { CollectionPickerPopover } from './CollectionPicker'
import { InlineEditableTitle, type InlineEditableTitleHandle } from './InlineEditableTitle'

function fail(err: unknown): void {
  toast(err instanceof RpcError ? err.message : fr.errors.generic)
}

/** Pilule d'une sous-collection (mini-vignette Ø22, nom, compteur) ; cible de dépôt interne. */
function SubCollectionPill({ node }: { node: CollectionNode }) {
  const navigate = useUi((s) => s.navigate)
  const [target, setTarget] = useState(false)
  const drop = internalDropTarget(
    (uuids) => void addToCollection({ uuid: node.uuid, name: node.name }, uuids),
    setTarget,
  )
  const cover = node.covers[0]
  const src = cover ? cardThumbSrc(cover) : undefined
  return (
    <button
      type="button"
      data-testid="subcollection-pill"
      data-uuid={node.uuid}
      className={cn(
        'flex h-9 shrink-0 items-center gap-2 rounded-full border pl-[7px] pr-3.5 transition-colors',
        target ? 'border-accent bg-surface' : 'border-border hover:bg-surface',
      )}
      onClick={() => navigate({ name: 'collection', uuid: node.uuid })}
      {...drop}
    >
      <span
        className="block h-[22px] w-[22px] shrink-0 overflow-hidden rounded-full"
        style={{ background: cover?.dominant ?? 'var(--skeleton)' }}
      >
        {src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            crossOrigin="anonymous"
            className="h-full w-full object-cover"
          />
        ) : null}
      </span>
      <span className="text-small font-medium text-fg">{node.name}</span>
      <span className="text-caption text-fg-faint tnum">{node.count}</span>
    </button>
  )
}

/** « + Nouvelle collection » : crée une sous-collection en ligne. */
function NewSubPill({ parentUuid }: { parentUuid: string }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])
  const commit = async () => {
    const n = name.trim()
    setEditing(false)
    setName('')
    if (!n) return
    try {
      await rpc('collections.create', { name: n, parentUuid })
    } catch (err) {
      fail(err)
    }
  }
  if (editing) {
    return (
      <input
        ref={ref}
        data-testid="new-subcollection-input"
        className="h-9 w-[200px] shrink-0 rounded-full border border-border-strong bg-bg px-3.5 text-small outline-none"
        placeholder={fr.collectionUi.subPlaceholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') void commit()
          if (e.key === 'Escape') {
            setName('')
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <button
      type="button"
      data-testid="new-subcollection"
      className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-border px-3.5 text-small text-fg-faint transition-colors hover:bg-surface hover:text-fg-muted"
      onClick={() => setEditing(true)}
    >
      <Plus size={13} strokeWidth={1.75} className="text-fg-disabled" />
      {fr.collection.new}
    </button>
  )
}

/** « Changer la couverture… » : choix parmi les membres (ou retour au mode automatique). */
function CoverPicker({
  node,
  items,
  open,
  onOpenChange,
}: {
  node: CollectionNode
  items: readonly ItemCard[]
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const pick = async (uuid: string | null) => {
    onOpenChange(false)
    try {
      await rpc('collections.update', { uuid: node.uuid, coverItemUuid: uuid })
    } catch (err) {
      fail(err)
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        title={fr.collectionUi.coverTitle}
        description={fr.collectionUi.coverHint}
        className="w-[min(640px,calc(100vw-48px))]"
        data-testid="cover-picker"
      >
        <div className="grid max-h-[420px] grid-cols-5 gap-2 overflow-y-auto px-5 pb-3 pt-4">
          {items.slice(0, 200).map((c) => {
            const src = cardThumbSrc(c)
            const current = node.coverItemUuid === c.uuid
            return (
              <button
                key={c.uuid}
                type="button"
                aria-pressed={current}
                className={cn(
                  'aspect-square overflow-hidden rounded-md border',
                  current ? 'border-accent ring-2 ring-accent' : 'border-border-subtle',
                )}
                style={{ background: c.dominant ?? 'var(--skeleton)' }}
                onClick={() => void pick(c.uuid)}
              >
                {src ? (
                  <img
                    src={src}
                    alt=""
                    draggable={false}
                    crossOrigin="anonymous"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="block p-1.5 text-left text-[10px] leading-3 text-fg-muted">
                    {c.post?.text?.slice(0, 80) ?? c.title ?? ''}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <div className="flex justify-end px-5 pb-5">
          <Button variant="secondary" onClick={() => void pick(null)}>
            {fr.collectionUi.coverAuto}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function CollectionView({ uuid }: { uuid: string }) {
  const tree = useCollections((s) => s.tree)
  const loaded = useCollections((s) => s.loaded)
  const node = useMemo(
    () => flattenTree(tree).find((f) => f.node.uuid === uuid)?.node ?? null,
    [tree, uuid],
  )
  const navigate = useUi((s) => s.navigate)
  const back = useUi((s) => s.back)
  const viewKey = `collection:${uuid}`
  const defaultColumns = usePrefs((s) => s.prefs.defaultColumns)
  const defaultSort = usePrefs((s) => s.prefs.defaultSort)
  const columns = useUi((s) => s.columns[viewKey]) ?? clampColumns(defaultColumns)
  const sort = useUi((s) => s.sorts[viewKey]) ?? defaultSort
  const setColumns = useUi((s) => s.setColumns)
  const setSort = useUi((s) => s.setSort)
  const [seed] = useState(() => Math.floor(Math.random() * 1_000_000))
  const { items, loaded: itemsLoaded } = useCollectionItems(uuid, sort, seed)
  const scrollRef = useRef<HTMLElement | null>(null)
  const titleRef = useRef<InlineEditableTitleHandle | null>(null)
  const [coverOpen, setCoverOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)

  useEffect(() => {
    void rpc('collections.markViewed', { uuid }).catch(() => undefined)
  }, [uuid])

  // Collection supprimée ailleurs : retour à l'étagère.
  useEffect(() => {
    if (loaded && !node) {
      toast(fr.collectionUi.notFound)
      navigate({ name: 'shelf' })
    }
  }, [loaded, node, navigate])

  if (!node) return null
  const ref = { uuid: node.uuid, name: node.name }

  const rename = async (name: string) => {
    try {
      await rpc('collections.update', { uuid, name })
    } catch (err) {
      fail(err)
    }
  }
  const newSub = async () => {
    const name = await askName({
      title: fr.collection.newSub,
      initial: '',
      confirmLabel: fr.shell.create,
    })
    if (!name) return
    try {
      await rpc('collections.create', { name, parentUuid: uuid })
    } catch (err) {
      fail(err)
    }
  }
  const moveTo = async (parent: CollectionNode | null) => {
    try {
      await rpc('collections.update', { uuid, parentUuid: parent?.uuid ?? null })
    } catch (err) {
      fail(err)
    }
  }
  const remove = async () => {
    const descendants = flattenTree(node.children).length
    const ok = await askConfirm({
      title: fr.collection.deleteConfirmTitle(node.name),
      body:
        descendants > 0
          ? `${fr.collection.deleteChildren(descendants)} ${fr.collection.deleteConfirmBody}`
          : fr.collection.deleteConfirmBody,
      confirmLabel: fr.confirm.delete,
      danger: true,
    })
    if (!ok) return
    try {
      await rpc('collections.delete', { uuid, keepChildren: false })
      navigate(node.parentUuid ? { name: 'collection', uuid: node.parentUuid } : { name: 'shelf' })
    } catch (err) {
      fail(err)
    }
  }

  return (
    <>
      <div
        data-testid="subheader"
        className="flex h-[61px] shrink-0 items-center justify-between border-b border-border-subtle pl-8 pr-[34px]"
      >
        <div className="flex min-w-0 items-center">
          <button
            type="button"
            data-testid="collection-back"
            aria-label={fr.collection.back}
            className="ml-px flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-border text-fg-subtle transition-colors hover:bg-surface"
            onClick={() =>
              node.parentUuid ? navigate({ name: 'collection', uuid: node.parentUuid }) : back()
            }
          >
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>
          <div className="ml-[11px] min-w-0">
            <InlineEditableTitle
              ref={titleRef}
              value={node.name}
              label={fr.collectionUi.titleLabel}
              onCommit={rename}
            />
          </div>
          <CollectionPickerPopover
            open={moveOpen}
            onOpenChange={setMoveOpen}
            allowRoot={node.parentUuid !== null}
            exclude={uuid}
            onPick={(p) => void moveTo(p)}
          >
            <span className="ml-3 h-7 w-0" aria-hidden="true" />
          </CollectionPickerPopover>
          <Menu.Dropdown.Root>
            <Menu.Dropdown.Trigger asChild>
              <button
                type="button"
                data-testid="collection-more"
                aria-label={fr.collectionUi.moreActions}
                className="flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-[var(--hover)]"
              >
                <Ellipsis size={18} strokeWidth={1.75} />
              </button>
            </Menu.Dropdown.Trigger>
            <Menu.Dropdown.Content align="start" data-testid="collection-menu">
              <Menu.Dropdown.Item icon={<Pencil />} onSelect={() => titleRef.current?.edit()}>
                {fr.collection.rename}
              </Menu.Dropdown.Item>
              <Menu.Dropdown.Item icon={<ImageIcon />} onSelect={() => setCoverOpen(true)}>
                {fr.collection.changeCover}
              </Menu.Dropdown.Item>
              <Menu.Dropdown.Item icon={<FolderPlus />} onSelect={() => void newSub()}>
                {fr.collection.newSub}
              </Menu.Dropdown.Item>
              <Menu.Dropdown.Item
                icon={<FolderInput />}
                data-testid="collection-move"
                onSelect={() => setTimeout(() => setMoveOpen(true), 0)}
              >
                {fr.collectionUi.moveTo}
              </Menu.Dropdown.Item>
              <Menu.Dropdown.Item icon={<Compass />} onSelect={soon}>
                {fr.collection.rediscoverThis}
              </Menu.Dropdown.Item>
              <Menu.Dropdown.Item icon={<Download />} onSelect={() => void exportZip(uuid)}>
                {fr.collection.exportZip}
              </Menu.Dropdown.Item>
              <Menu.Dropdown.Item
                tone="danger"
                icon={<Trash />}
                data-testid="collection-delete"
                onSelect={() => void remove()}
              >
                {fr.collection.delete}
              </Menu.Dropdown.Item>
            </Menu.Dropdown.Content>
          </Menu.Dropdown.Root>
        </div>
        <div className="flex items-center gap-5">
          <ColumnSlider columns={columns} onChange={(n) => setColumns(viewKey, n)} />
          <SortMenu value={sort} onChange={(s) => setSort(viewKey, s)} />
        </div>
      </div>
      <main
        ref={scrollRef}
        data-testid="collection-scroll"
        className="relative min-h-0 flex-1 overflow-y-auto pb-[100px]"
        aria-label={node.name}
      >
        <div className="px-[18px] pt-4">
          <div
            data-testid="collection-inside-label"
            className="text-micro font-medium uppercase text-fg-faint"
          >
            {fr.collection.inside}
          </div>
          <div
            className="no-scrollbar mt-[11px] flex gap-2 overflow-x-auto"
            aria-label={fr.collectionUi.pillsLabel}
            data-testid="subcollection-pills"
          >
            {node.children.map((c) => (
              <SubCollectionPill key={c.uuid} node={c} />
            ))}
            <NewSubPill parentUuid={uuid} />
          </div>
        </div>
        <div className="pt-[23px]">
          {!itemsLoaded ? null : items.length === 0 ? (
            <EmptyState
              className="pt-20"
              title={fr.collection.empty}
              description={fr.collection.emptyHint}
            />
          ) : (
            <MasonryGrid
              items={items}
              columns={columns}
              scrollRef={scrollRef}
              context="collection"
              collection={ref}
            />
          )}
        </div>
      </main>
      <CoverPicker node={node} items={items} open={coverOpen} onOpenChange={setCoverOpen} />
    </>
  )
}

export default function CollectionPage() {
  const route = useUi((s) => s.route)
  if (route.name !== 'collection') return null
  return <CollectionView key={route.uuid} uuid={route.uuid} />
}
