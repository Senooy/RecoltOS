/**
 * Canvas context menus: node (Copier, Dupliquer, Premier plan,
 * Arrière-plan, Verrouiller, Ouvrir dans la bibliothèque, Ajouter à la bibliothèque, Supprimer)
 * and canvas (Coller, Nouvelle note, Nouveau texte, Tout sélectionner, Ajuster à l'écran).
 */
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  CopyPlus,
  FolderInput,
  Lock,
  LockOpen,
  Maximize,
  Maximize2,
  MousePointerSquareDashed,
  StickyNote,
  Trash2,
  Type,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { Vec } from '../../../../../../shared/spaces-geometry'
import { Menu } from '../../../../components/ui'
import { tr } from '../../../../i18n'
import { openViewerByUuid } from '../../../viewer/open'
import {
  copySelection,
  createAt,
  deleteSelection,
  duplicateSelection,
  fitAll,
  pasteClipboard,
  promoteNodes,
  reorderSelection,
  selectAll,
  toggleLock,
} from '../actions'
import { useSpace } from '../store/spaceStore'

export function CanvasContextMenu({
  at,
  nodeId,
  children,
}: {
  at: Vec
  nodeId: string | null
  children: ReactNode
}) {
  const node = useSpace((s) => (nodeId ? s.nodes[nodeId] : undefined))
  const selection = useSpace((s) => s.selection)
  const multi = selection.length > 1
  return (
    <Menu.Context.Root>
      <Menu.Context.Trigger asChild>
        <div className="h-full w-full">{children}</div>
      </Menu.Context.Trigger>
      {node ? (
        <Menu.Context.Content data-testid="node-menu">
          <Menu.Context.Item icon={<Copy />} onSelect={() => void copySelection(false)}>
            {tr.spacesUi.copy}
          </Menu.Context.Item>
          <Menu.Context.Item icon={<CopyPlus />} onSelect={() => void duplicateSelection()}>
            {tr.spacesUi.duplicate}
          </Menu.Context.Item>
          <Menu.Context.Separator />
          <Menu.Context.Item icon={<ArrowUpToLine />} onSelect={() => reorderSelection('front')}>
            {tr.spacesUi.bringToFront}
          </Menu.Context.Item>
          <Menu.Context.Item icon={<ArrowDownToLine />} onSelect={() => reorderSelection('back')}>
            {tr.spacesUi.sendToBack}
          </Menu.Context.Item>
          <Menu.Context.Item
            icon={node.locked ? <LockOpen /> : <Lock />}
            data-testid="node-menu-lock"
            onSelect={toggleLock}
          >
            {node.locked ? tr.spacesUi.unlock : tr.spacesUi.lock}
          </Menu.Context.Item>
          {!multi && node.type === 'item' && node.itemUuid ? (
            <Menu.Context.Item
              icon={<Maximize2 />}
              onSelect={() => openViewerByUuid(node.itemUuid!)}
            >
              {tr.spacesUi.openInLibrary}
            </Menu.Context.Item>
          ) : null}
          {node.type === 'image' ? (
            <Menu.Context.Item
              icon={<FolderInput />}
              data-testid="node-menu-promote"
              onSelect={() => void promoteNodes(selection.length > 0 ? selection : [node.uuid])}
            >
              {tr.spacesUi.addToLibrary}
            </Menu.Context.Item>
          ) : null}
          <Menu.Context.Separator />
          <Menu.Context.Item tone="danger" icon={<Trash2 />} onSelect={deleteSelection}>
            {tr.spacesUi.delete}
          </Menu.Context.Item>
        </Menu.Context.Content>
      ) : (
        <Menu.Context.Content data-testid="canvas-menu">
          <Menu.Context.Item icon={<ClipboardPaste />} onSelect={() => void pasteClipboard(at)}>
            {tr.spacesUi.paste}
          </Menu.Context.Item>
          <Menu.Context.Item icon={<StickyNote />} onSelect={() => createAt('note', at)}>
            {tr.spacesUi.newNote}
          </Menu.Context.Item>
          <Menu.Context.Item icon={<Type />} onSelect={() => createAt('text', at)}>
            {tr.spacesUi.newText}
          </Menu.Context.Item>
          <Menu.Context.Separator />
          <Menu.Context.Item icon={<MousePointerSquareDashed />} onSelect={selectAll}>
            {tr.spacesUi.selectAll}
          </Menu.Context.Item>
          <Menu.Context.Item icon={<Maximize />} onSelect={fitAll}>
            {tr.spacesUi.fitScreen}
          </Menu.Context.Item>
        </Menu.Context.Content>
      )}
    </Menu.Context.Root>
  )
}
