/**
 * Barre de sélection : pilule flottante « 3 sélectionnés » + actions (Ajouter à…,
 * Masquer, Télécharger, Supprimer) ; Échap ou `X` désélectionne.
 */
import { X } from 'lucide-react'
import { Menu, PillBar } from '../components/ui'
import { tr } from '../i18n'
import { addToCollection, download, setHidden, trashItems } from '../features/grid/actions'
import { flattenTree, useCollections } from '../state/collections'
import { useUi } from '../state/ui'

export function SelectionBar() {
  const selection = useUi((s) => s.selection)
  const clear = useUi((s) => s.clearSelection)
  const tree = useCollections((s) => s.tree)
  if (selection.length === 0) return null
  const uuids = [...selection]
  return (
    <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
      <PillBar data-testid="selection-bar">
        <span className="pr-2 tnum">{tr.count.selected(uuids.length)}</span>
        <Menu.Dropdown.Root>
          <Menu.Dropdown.Trigger asChild>
            <PillBar.Action tone="ghost">{tr.shell.addTo}</PillBar.Action>
          </Menu.Dropdown.Trigger>
          <Menu.Dropdown.Content side="top" className="max-h-[320px] overflow-y-auto">
            {flattenTree(tree).map(({ node, depth }) => (
              <Menu.Dropdown.Item
                key={node.uuid}
                style={{ paddingLeft: 8 + depth * 12 }}
                onSelect={() => {
                  void addToCollection({ uuid: node.uuid, name: node.name }, uuids)
                  clear()
                }}
              >
                {node.name}
              </Menu.Dropdown.Item>
            ))}
          </Menu.Dropdown.Content>
        </Menu.Dropdown.Root>
        <PillBar.Action tone="ghost" onClick={() => void setHidden(uuids, true).then(clear)}>
          {tr.shell.hide}
        </PillBar.Action>
        <PillBar.Action tone="ghost" onClick={() => void download(uuids)}>
          {tr.shell.download}
        </PillBar.Action>
        <PillBar.Action tone="danger" onClick={() => void trashItems(uuids).then(clear)}>
          {tr.shell.delete}
        </PillBar.Action>
        <button
          type="button"
          aria-label={tr.shell.selectionClear}
          className="ml-1 flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--hover)]"
          onClick={clear}
        >
          <X size={14} />
        </button>
      </PillBar>
    </div>
  )
}
