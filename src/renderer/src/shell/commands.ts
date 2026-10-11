/**
 * Commandes de la coque (menu natif `evt:menu.command`, FAB, raccourcis de repli).
 */
import type { MenuCommand } from '../../../shared/shortcuts'
import { toast } from '../components/ui'
import { fr } from '../i18n/fr'
import { RpcError, rpc } from '../lib/rpc'
import { isEditableTarget } from '../lib/shortcuts'
import { askName } from '../state/dialogs'
import { effectiveTheme, usePrefs } from '../state/prefs'
import { useUi } from '../state/ui'
import { useUndo } from '../state/undo'

export function soon(): void {
  toast(fr.shell.unavailable)
}

export async function importFiles(collectionUuid?: string): Promise<void> {
  try {
    const r = await rpc('ingest.pickFiles', collectionUuid ? { collectionUuid } : {})
    if (r && r.added.length > 0) toast(fr.toast.importDone(r.added.length))
    else if (r && r.failed.length > 0) toast(r.failed[0]!.message)
  } catch (err) {
    toast(err instanceof RpcError ? err.message : fr.errors.generic)
  }
}

export async function newCollection(): Promise<void> {
  const name = await askName({
    title: fr.collection.new,
    initial: '',
    confirmLabel: fr.shell.create,
  })
  if (!name) return
  try {
    await rpc('collections.create', { name })
  } catch (err) {
    toast(err instanceof RpcError ? err.message : fr.errors.generic)
  }
}

/** Export zip (bibliothèque ou collection) ; la progression arrive par `export.progress`. */
export async function exportZip(collectionUuid?: string): Promise<void> {
  try {
    const r = await rpc('data.exportZip', {
      includeDerived: false,
      ...(collectionUuid ? { collectionUuid } : {}),
    })
    if ('path' in r) toast(fr.toast.exportDone)
  } catch (err) {
    toast(err instanceof RpcError ? err.message : fr.errors.generic)
  }
}

export async function createSnapshot(): Promise<void> {
  try {
    await rpc('data.snapshot.create', { reason: 'manual' })
    toast(fr.settingsMoreUi.snapshotDone)
  } catch (err) {
    toast(err instanceof RpcError ? err.message : fr.errors.generic)
  }
}

export function toggleTheme(): void {
  const prefs = usePrefs.getState().prefs
  const next = effectiveTheme(prefs.theme) === 'dark' ? 'light' : 'dark'
  void usePrefs
    .getState()
    .update({ theme: next })
    .catch(() => undefined)
}

/** Sélection de toutes les cartes affichées (⌘A hors champ texte). */
function selectAllVisible(): void {
  const uuids = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="grid"] [data-uuid]'),
  ).map((el) => el.dataset.uuid!)
  if (uuids.length > 0) useUi.getState().setSelection(uuids)
}

export function runMenuCommand(cmd: MenuCommand): void {
  const ui = useUi.getState()
  const editing = isEditableTarget(document.activeElement)
  switch (cmd) {
    case 'palette':
      // Un seul déclencheur : l'accélérateur ⌘K du menu natif (pas d'écouteur renderer).
      if (ui.overlay?.type === 'palette') ui.closeOverlay()
      else ui.openOverlay({ type: 'palette' })
      return
    case 'goLibrary':
      ui.navigate({ name: 'library' })
      return
    case 'goCollections':
      ui.navigate({ name: 'shelf' })
      return
    case 'goSpaces':
      ui.navigate({ name: 'spaces' })
      return
    case 'search':
      ui.openSearch()
      return
    case 'settings':
      ui.openOverlay({ type: 'settings' })
      return
    case 'importGatheros':
      ui.openOverlay({ type: 'settings', section: 'libraries' })
      return
    case 'toggleTheme':
      toggleTheme()
      return
    case 'importFiles':
      void importFiles(ui.route.name === 'collection' ? ui.route.uuid : undefined)
      return
    case 'newCollection':
      void newCollection()
      return
    case 'exportZip':
      void exportZip()
      return
    case 'snapshot':
      void createSnapshot()
      return
    case 'undo':
    case 'redo':
    case 'selectAll':
      if (editing) {
        void rpc('system.edit', { cmd }).catch(() => undefined)
        return
      }
      if (cmd === 'selectAll') selectAllVisible()
      else
        void (cmd === 'undo' ? useUndo.getState().undo() : useUndo.getState().redo()).catch(
          () => undefined,
        )
      return
    case 'zoomIn':
    case 'zoomOut':
    case 'zoomReset':
      return
    default:
      soon()
  }
}
