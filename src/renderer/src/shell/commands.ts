/**
 * Shell commands (native menu `evt:menu.command`, FAB, fallback shortcuts).
 */
import type { MenuCommand } from '../../../shared/shortcuts'
import { toast } from '../components/ui'
import { tr } from '../i18n'
import { RpcError, rpc } from '../lib/rpc'
import { runCapture } from '../features/capture/capture-actions'
import { importFolder, reportImport, useImportUi } from '../features/import/import-actions'
import { newSpace } from '../features/spaces/space-actions'
import { emit } from '../lib/bus'
import { setThemeTransitionOrigin } from '../lib/theme-transition'
import { isEditableTarget } from '../lib/shortcuts'
import { askName } from '../state/dialogs'
import { effectiveTheme, usePrefs } from '../state/prefs'
import { useUi } from '../state/ui'
import { useUndo } from '../state/undo'

/** Rediscover (⇧⌘R, header button): scope = open collection, otherwise library. */
export function openRediscover(): void {
  const ui = useUi.getState()
  if (ui.overlay?.type === 'rediscover') return
  ui.openOverlay(
    ui.route.name === 'collection'
      ? { type: 'rediscover', collectionUuid: ui.route.uuid }
      : { type: 'rediscover' },
  )
}

export function soon(): void {
  toast(tr.shell.unavailable)
}

export async function importFiles(collectionUuid?: string): Promise<void> {
  try {
    reportImport(await rpc('ingest.pickFiles', collectionUuid ? { collectionUuid } : {}))
  } catch (err) {
    toast(err instanceof RpcError ? err.message : tr.errors.generic)
  }
}

export async function newCollection(): Promise<void> {
  const name = await askName({
    title: tr.collection.new,
    initial: '',
    confirmLabel: tr.shell.create,
  })
  if (!name) return
  try {
    await rpc('collections.create', { name })
  } catch (err) {
    toast(err instanceof RpcError ? err.message : tr.errors.generic)
  }
}

/** Zip export (library or collection); progress arrives via `export.progress`. */
export async function exportZip(collectionUuid?: string): Promise<void> {
  try {
    const r = await rpc('data.exportZip', {
      includeDerived: false,
      ...(collectionUuid ? { collectionUuid } : {}),
    })
    if ('path' in r) toast(tr.toast.exportDone)
  } catch (err) {
    toast(err instanceof RpcError ? err.message : tr.errors.generic)
  }
}

export async function createSnapshot(): Promise<void> {
  try {
    await rpc('data.snapshot.create', { reason: 'manual' })
    toast(tr.settingsMoreUi.snapshotDone)
  } catch (err) {
    toast(err instanceof RpcError ? err.message : tr.errors.generic)
  }
}

/**
 * Light ⇄ dark. `origin`: the control clicked, the new theme spreads from its center (otherwise
 * from the center of the window: shortcut, menu, palette).
 */
export function toggleTheme(origin?: Element): void {
  setThemeTransitionOrigin(origin)
  const prefs = usePrefs.getState().prefs
  const next = effectiveTheme(prefs.theme) === 'dark' ? 'light' : 'dark'
  void usePrefs
    .getState()
    .update({ theme: next })
    .catch(() => undefined)
}

/** Selects all displayed cards (⌘A outside a text field). */
function selectAllVisible(): void {
  const uuids = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="grid"] [data-uuid]'),
  ).map((el) => el.dataset.uuid!)
  if (uuids.length > 0) useUi.getState().setSelection(uuids)
}

const SPACE_COMMANDS: ReadonlySet<MenuCommand> = new Set<MenuCommand>([
  'undo',
  'redo',
  'selectAll',
  'zoomIn',
  'zoomOut',
  'zoomReset',
  'quickLook',
])

export function runMenuCommand(cmd: MenuCommand): void {
  const ui = useUi.getState()
  const editing = isEditableTarget(document.activeElement)
  // Space editor: undo, redo, select all, zoom and preview go to the canvas.
  if (ui.route.name === 'space' && !ui.overlay && !editing && SPACE_COMMANDS.has(cmd)) {
    emit('space.command', { cmd })
    return
  }
  switch (cmd) {
    case 'palette':
      // Single trigger: the native menu's ⌘K accelerator (no renderer listener).
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
    case 'rediscover':
      openRediscover()
      return
    case 'capture':
      void runCapture()
      return
    case 'importFolder':
      void importFolder(ui.route.name === 'collection' ? ui.route.uuid : undefined)
      return
    case 'pasteUrl':
      if (!ui.overlay) useImportUi.getState().setUrlOpen(true)
      return
    case 'importFiles':
      void importFiles(ui.route.name === 'collection' ? ui.route.uuid : undefined)
      return
    case 'newCollection':
      void newCollection()
      return
    case 'newSpace':
      void newSpace()
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
    case 'toggleDetails':
      // Zoom and Details panel: only in the detail view (no effect elsewhere).
      if (ui.overlay?.type === 'viewer') emit('overlay.command', { cmd })
      return
    case 'quickLook':
      if (ui.overlay?.type === 'viewer') emit('overlay.command', { cmd })
      else if (ui.selection.length === 1)
        void rpc('system.quickLook', { itemUuid: ui.selection[0]! }).catch(() => undefined)
      return
    default:
      soon()
  }
}
