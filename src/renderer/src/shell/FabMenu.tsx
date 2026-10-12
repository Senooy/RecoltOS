/**
 * Menu du FAB « + » : « Importer des fichiers… » ⌘O, « Importer un
 * dossier… », « Coller une URL… » (`UrlPopover`), « Capturer l'écran » ⇧⌘S ; dans une collection,
 * titre « Ajouter à « Dev » ». Le « + » pivote de 45° à l'ouverture.
 */
import { Camera, FileUp, FolderUp, Link2, Plus } from 'lucide-react'
import { useState } from 'react'
import { Menu, Popover } from '../components/ui'
import { keysOf } from '../features/palette/commands'
import { fr } from '../i18n/fr'
import { cn } from '../lib/cn'
import { UrlPopoverContent } from '../features/import/UrlPopover'
import { useImportUi } from '../features/import/import-actions'

export function FabMenu({
  collection,
  onImportFiles,
  onImportFolder,
  onCapture,
}: {
  collection: { uuid: string; name: string } | null
  onImportFiles: () => void
  onImportFolder: () => void
  onCapture: () => void
}) {
  const [open, setOpen] = useState(false)
  const urlOpen = useImportUi((s) => s.urlOpen)
  const setUrlOpen = useImportUi((s) => s.setUrlOpen)
  return (
    <Popover.Root open={urlOpen} onOpenChange={setUrlOpen}>
      <Menu.Dropdown.Root open={open} onOpenChange={setOpen}>
        <Popover.Anchor asChild>
          <Menu.Dropdown.Trigger asChild>
            <button
              type="button"
              data-testid="fab"
              aria-label={fr.fab.label}
              className="fab-surface fixed bottom-6 right-6 z-30 flex h-[52px] w-[52px] items-center justify-center rounded-full text-fg transition-transform duration-150 hover:scale-105 active:scale-[.96]"
              style={{ boxShadow: 'var(--shadow-fab)' }}
            >
              <Plus
                size={24}
                strokeWidth={2}
                className={cn(
                  'transition-transform duration-200',
                  (open || urlOpen) && 'rotate-45',
                )}
              />
            </button>
          </Menu.Dropdown.Trigger>
        </Popover.Anchor>
        <Menu.Dropdown.Content side="top" align="end" className="w-[220px]" data-testid="fab-menu">
          {collection ? (
            <Menu.Dropdown.Label>{fr.importUiMore.addTo(collection.name)}</Menu.Dropdown.Label>
          ) : null}
          <Menu.Dropdown.Item icon={<FileUp />} shortcut={['⌘', 'O']} onSelect={onImportFiles}>
            {fr.fab.importFiles}
          </Menu.Dropdown.Item>
          <Menu.Dropdown.Item icon={<FolderUp />} onSelect={onImportFolder}>
            {fr.importUiMore.importFolder}
          </Menu.Dropdown.Item>
          <Menu.Dropdown.Item
            icon={<Link2 />}
            data-testid="fab-paste-url"
            onSelect={() => setTimeout(() => setUrlOpen(true), 0)}
          >
            {fr.importUiMore.pasteUrl}
          </Menu.Dropdown.Item>
          <Menu.Dropdown.Item icon={<Camera />} shortcut={keysOf('capture')} onSelect={onCapture}>
            {fr.fab.capture}
          </Menu.Dropdown.Item>
        </Menu.Dropdown.Content>
      </Menu.Dropdown.Root>
      <UrlPopoverContent collection={collection} onDone={() => setUrlOpen(false)} />
    </Popover.Root>
  )
}
