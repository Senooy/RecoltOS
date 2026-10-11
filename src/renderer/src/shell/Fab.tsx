/**
 * Bouton flottant « + » (DESIGN §2.6) : Ø52, `right/bottom: 24`, verre + ombre. Le menu complet
 * (`shell/FabMenu.tsx`) arrive avec WP-34 ; en M1 : importer des fichiers, importer depuis la référence.
 */
import { Download, FileUp, Plus } from 'lucide-react'
import { Menu } from '../components/ui'
import { fr } from '../i18n/fr'

export function Fab({
  onImportFiles,
  onImportla référence,
}: {
  onImportFiles: () => void
  onImportla référence: () => void
}) {
  return (
    <Menu.Dropdown.Root>
      <Menu.Dropdown.Trigger asChild>
        <button
          type="button"
          data-testid="fab"
          aria-label={fr.fab.label}
          className="fab-surface fixed bottom-6 right-6 z-30 flex h-[52px] w-[52px] items-center justify-center rounded-full text-fg transition-transform duration-150 hover:scale-105 active:scale-[.96]"
          style={{ boxShadow: 'var(--shadow-fab)' }}
        >
          <Plus size={24} strokeWidth={2} />
        </button>
      </Menu.Dropdown.Trigger>
      <Menu.Dropdown.Content side="top" align="end" className="w-[220px]">
        <Menu.Dropdown.Item icon={<FileUp />} shortcut={['⌘', 'O']} onSelect={onImportFiles}>
          {fr.fab.importFiles}
        </Menu.Dropdown.Item>
        <Menu.Dropdown.Item icon={<Download />} onSelect={onImportla référence}>
          {fr.palette.cmd.importla référence}
        </Menu.Dropdown.Item>
      </Menu.Dropdown.Content>
    </Menu.Dropdown.Root>
  )
}
