/**
 * `SaveContextMenu` : contenu du menu contextuel des cartes, variantes
 * bibliothèque / collection / masqués / corbeille / multi-sélection. Sous-menu « Ajouter à une
 * collection » avec filtre au-delà de 8 collections et « Nouvelle collection… ».
 */
import {
  ArchiveRestore,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Sparkles,
  Trash,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ItemCard } from '../../../../shared/dto/items'
import { Menu } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { rpc } from '../../lib/rpc'
import { flattenTree, useCollections } from '../../state/collections'
import { askName } from '../../state/dialogs'
import { usePrefs } from '../../state/prefs'
import { analyzeItems } from '../ai/ai-actions'
import { AddToSpaceSub } from '../spaces/AddToSpaceMenu'
import {
  addToCollection,
  copyFor,
  download,
  openSource,
  removeFromCollection,
  restoreItems,
  reveal,
  setCover,
  setHidden,
  trashItems,
} from './actions'

export type MenuContext = 'library' | 'collection' | 'hidden' | 'trash'

const SOURCE_NAMES: Record<string, string> = { x: 'X', instagram: 'Instagram', cosmos: 'Cosmos' }

function CollectionsSub({ uuids, onNew }: { uuids: string[]; onNew: () => void }) {
  const tree = useCollections((s) => s.tree)
  const [filter, setFilter] = useState('')
  const flat = useMemo(() => flattenTree(tree), [tree])
  const shown = filter
    ? flat.filter((f) => f.node.name.toLowerCase().includes(filter.toLowerCase()))
    : flat
  return (
    <Menu.Context.SubContent className="max-h-[360px] overflow-y-auto">
      {flat.length > 8 ? (
        <input
          className="mb-1 h-7 w-full rounded-sm border border-border bg-bg px-2 text-small outline-none"
          placeholder={fr.menu.filter}
          value={filter}
          autoFocus
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      ) : null}
      {shown.map(({ node, depth }) => (
        <Menu.Context.Item
          key={node.uuid}
          style={{ paddingLeft: 8 + depth * 12 }}
          onSelect={() => void addToCollection({ uuid: node.uuid, name: node.name }, uuids)}
        >
          {node.name}
        </Menu.Context.Item>
      ))}
      <Menu.Context.Item icon={<FolderPlus />} onSelect={onNew}>
        {fr.menu.newCollectionEllipsis}
      </Menu.Context.Item>
    </Menu.Context.SubContent>
  )
}

export function SaveContextMenuContent({
  cards,
  context,
  collection,
  onDeleteForever,
}: {
  cards: ItemCard[]
  context: MenuContext
  collection?: { uuid: string; name: string } | undefined
  onDeleteForever: (uuids: string[]) => void
}) {
  const uuids = cards.map((c) => c.uuid)
  const n = cards.length
  const one = n === 1 ? cards[0]! : null
  // « Analyser avec l'IA » seulement quand un moteur est actif (menu de base sinon).
  const aiOn = usePrefs((st) => st.prefs.ai.provider) !== 'off'
  const newCollection = async () => {
    const name = await askName({
      title: fr.collection.new,
      initial: '',
      confirmLabel: fr.shell.create,
    })
    if (!name?.trim()) return
    try {
      const c = await rpc('collections.create', { name: name.trim() })
      await addToCollection({ uuid: c.uuid, name: c.name }, uuids)
    } catch {
      // toast affiché par l'action
    }
  }

  if (context === 'trash') {
    return (
      <Menu.Context.Content data-testid="ctx-menu">
        <Menu.Context.Item icon={<ArchiveRestore />} onSelect={() => void restoreItems(uuids)}>
          {fr.menu.restore}
        </Menu.Context.Item>
        {one ? (
          <Menu.Context.Item icon={<FolderOpen />} onSelect={() => void reveal(one)}>
            {fr.menu.revealInFinder}
          </Menu.Context.Item>
        ) : null}
        <Menu.Context.Item tone="danger" icon={<Trash />} onSelect={() => onDeleteForever(uuids)}>
          {fr.menu.deleteForever}
        </Menu.Context.Item>
      </Menu.Context.Content>
    )
  }

  const copyLabel =
    one?.kind === 'tweet'
      ? fr.menu.copyText
      : one?.kind === 'url'
        ? fr.menu.copyLink
        : fr.menu.copyImage
  const openLabel =
    one?.kind === 'url'
      ? fr.menu.openPage
      : one && SOURCE_NAMES[one.source]
        ? fr.menu.openOn(SOURCE_NAMES[one.source]!)
        : null
  const canOpen =
    one !== null && openLabel !== null && (one.sourceHost !== null || one.kind !== 'url')
  return (
    <Menu.Context.Content data-testid="ctx-menu">
      <Menu.Context.Sub>
        <Menu.Context.SubTrigger icon={<FolderPlus />}>
          {n > 1 ? fr.menu.plural.add(n) : fr.menu.addToCollection}
        </Menu.Context.SubTrigger>
        <CollectionsSub uuids={uuids} onNew={() => void newCollection()} />
      </Menu.Context.Sub>
      <AddToSpaceSub uuids={uuids} />
      {context === 'collection' && collection ? (
        <>
          <Menu.Context.Item
            icon={<FolderMinus />}
            onSelect={() => void removeFromCollection(collection, uuids)}
          >
            {fr.menu.removeFrom(collection.name)}
          </Menu.Context.Item>
          {one ? (
            <Menu.Context.Item
              icon={<ImageIcon />}
              onSelect={() => void setCover(collection.uuid, one.uuid)}
            >
              {fr.menu.setCover}
            </Menu.Context.Item>
          ) : null}
        </>
      ) : null}
      {context === 'hidden' ? (
        <Menu.Context.Item icon={<Eye />} onSelect={() => void setHidden(uuids, false)}>
          {fr.menu.unhide}
        </Menu.Context.Item>
      ) : (
        <Menu.Context.Item icon={<EyeOff />} onSelect={() => void setHidden(uuids, true)}>
          {n > 1 ? fr.menu.plural.hide(n) : fr.menu.hide}
        </Menu.Context.Item>
      )}
      {one ? (
        <Menu.Context.Item icon={<Copy />} onSelect={() => void copyFor(one)}>
          {copyLabel}
        </Menu.Context.Item>
      ) : null}
      {one && canOpen && openLabel ? (
        <Menu.Context.Item icon={<ExternalLink />} onSelect={() => void openSource(one)}>
          {openLabel}
        </Menu.Context.Item>
      ) : null}
      {one ? (
        <Menu.Context.Item icon={<FolderOpen />} onSelect={() => void reveal(one)}>
          {fr.menu.revealInFinder}
        </Menu.Context.Item>
      ) : null}
      {aiOn ? (
        <Menu.Context.Item
          icon={<Sparkles />}
          data-testid="ctx-ai-analyze"
          onSelect={() => void analyzeItems(uuids, { force: true })}
        >
          {fr.ai.analyze}
        </Menu.Context.Item>
      ) : null}
      <Menu.Context.Item icon={<Download />} onSelect={() => void download(uuids)}>
        {n > 1 ? fr.menu.plural.download(n) : fr.menu.download}
      </Menu.Context.Item>
      <Menu.Context.Item tone="danger" icon={<Trash />} onSelect={() => void trashItems(uuids)}>
        {n > 1 ? fr.menu.plural.delete(n) : fr.menu.delete}
      </Menu.Context.Item>
    </Menu.Context.Content>
  )
}
