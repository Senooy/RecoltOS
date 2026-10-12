/**
 * Éditeur de space (route `space`) : sous-barre 60 px (retour, nom
 * en ligne, « … » Arrière-plan / Dupliquer / Exporter / Supprimer), toile plein cadre, dock
 * d'outils, cluster de zoom, barre de style, tiroir Bibliothèque, menus contextuels. Clavier :
 * table `SPACES_SHORTCUTS` (keymap AZERTY / QWERTY), commandes du menu natif relayées par le bus
 * (`space.command`), presse-papiers par les événements DOM `copy` / `cut` / `paste`.
 * Persistance : vidage à la sortie, au blur / masquage, au handshake de fermeture (après validation
 * de l'édition en cours) et `applyBatchSync` en `beforeunload`.
 */
import { ChevronLeft, Copy, Download, Ellipsis, Grid3x3, Pencil, Trash } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ItemCard } from '../../../../shared/dto/items'
import { aabb, unionRect, type Vec } from '../../../../shared/spaces-geometry'
import { Menu, toast } from '../../components/ui'
import { tr } from '../../i18n'
import { on } from '../../lib/bus'
import { isEditableTarget } from '../../lib/shortcuts'
import { RpcError, rpc } from '../../lib/rpc'
import { registerFlush } from '../../state/flush'
import { useUi } from '../../state/ui'
import {
  InlineEditableTitle,
  type InlineEditableTitleHandle,
} from '../collections/InlineEditableTitle'
import { isExternalDrag, readDrop } from '../import/walk'
import {
  addFilesAt,
  addItemsAt,
  alignSelection,
  copySelection,
  createAt,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  fail,
  fitAll,
  fitSelection,
  nudge,
  pasteClipboard,
  placeAssetsAt,
  reorderSelection,
  selectAll,
  toggleLock,
  zoomStep,
  zoomTo,
} from './editor/actions'
import { CanvasContextMenu } from './editor/chrome/ContextMenus'
import { ExportPopover } from './editor/chrome/ExportPopover'
import { LibraryDrawer, cachedCards } from './editor/chrome/LibraryDrawer'
import { StyleBar } from './editor/chrome/StyleBar'
import { ToolDock } from './editor/chrome/ToolDock'
import { ZoomCluster } from './editor/chrome/ZoomCluster'
import { fitBox } from './editor/geometry/camera'
import { initKeymap, resolveShortcut } from './editor/keymap'
import {
  commitEditing,
  configureStore,
  history,
  loadDoc,
  persistence,
  redo,
  resetStore,
  setBackground,
  setCamera,
  setName,
  setTool,
  undo,
  useCamera,
  useSpace,
} from './editor/store/spaceStore'
import { Viewport, type ViewportHandle } from './editor/Viewport'
import { consumePendingRename, deleteSpaceWithConfirm, duplicateSpace } from './space-actions'
import './spaces.css'

const ITEMS_MIME = 'application/x-recoltos-items'

configureStore({
  send: (p) => rpc('spaces.applyBatch', p),
  onInvalid: (n) => toast(tr.spaces.invalidNodes(n)),
  onRetry: () => toast(tr.spaces.saveRetry, { id: 'space-save-retry' }),
})

// Tests de bout en bout seulement : accès au store de l'éditeur (jamais hors `RECOLTOS_E2E`).
if (window.recolt?.flags.e2e) {
  ;(window as unknown as { __recoltSpaces?: unknown }).__recoltSpaces = {
    useSpace,
    useCamera,
    persistence,
    history,
    resolveShortcut,
  }
}

/**
 * Le clavier (keydown) et le menu natif (accélérateur) peuvent livrer la même commande : le
 * keydown s'exécute toujours ; le menu est ignoré s'il suit de près un keydown identique.
 */
const lastKey = new Map<string, number>()
let fromMenu = false
function once(cmd: string, fn: () => void): void {
  const t = performance.now()
  if (fromMenu) {
    if (t - (lastKey.get(cmd) ?? -1e9) < 150) return
  } else lastKey.set(cmd, t)
  fn()
}

function runCommand(cmd: string): boolean {
  switch (cmd) {
    case 'undo':
      once('undo', () => void undo())
      return true
    case 'redo':
    case 'redoAlt':
      once('redo', () => void redo())
      return true
    case 'selectAll':
      once('selectAll', selectAll)
      return true
    case 'zoomIn':
      once('zoomIn', () => zoomStep(1))
      return true
    case 'zoomOut':
      once('zoomOut', () => zoomStep(-1))
      return true
    case 'zoomReset':
    case 'zoom100':
      once('zoom100', () => zoomTo(1))
      return true
    case 'quickLook':
      quickLookSelection()
      return true
    default:
      return false
  }
}

function quickLookSelection(): boolean {
  const st = useSpace.getState()
  if (st.selection.length !== 1) return false
  const n = st.nodes[st.selection[0]!]
  if (n?.type === 'item' && n.itemUuid) {
    void rpc('system.quickLook', { itemUuid: n.itemUuid }).catch(() => undefined)
    return true
  }
  return false
}

function editSelected(): void {
  const st = useSpace.getState()
  if (st.selection.length !== 1) return
  const n = st.nodes[st.selection[0]!]
  if (n && !n.locked && (n.type === 'note' || n.type === 'text' || n.type === 'shape')) {
    useSpace.setState({ editingId: n.uuid })
  }
}

async function cardsFor(uuids: readonly string[]): Promise<ItemCard[]> {
  const known = cachedCards()
  const out: ItemCard[] = []
  for (const u of uuids) {
    const c = known.get(u) ?? useSpace.getState().items[u]
    if (c) out.push(c)
    else {
      const d = await rpc('items.get', { uuid: u }).catch(() => null)
      if (d) out.push(d)
    }
  }
  return out
}

function EditorView({ uuid }: { uuid: string }) {
  const loaded = useSpace((s) => s.loaded && s.spaceUuid === uuid)
  const name = useSpace((s) => s.name)
  const background = useSpace((s) => s.background)
  const drawerOpen = useSpace((s) => s.drawerOpen)
  const back = () => useUi.getState().navigate({ name: 'spaces' })
  const titleRef = useRef<InlineEditableTitleHandle | null>(null)
  const viewport = useRef<ViewportHandle | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [menuAt, setMenuAt] = useState<{ at: Vec; nodeId: string | null }>({
    at: { x: 0, y: 0 },
    nodeId: null,
  })

  // Chargement (après vidage de l'espace précédent).
  useEffect(() => {
    let alive = true
    void (async () => {
      await persistence.flush()
      try {
        const doc = await rpc('spaces.get', { uuid })
        if (!alive) return
        loadDoc({
          uuid,
          name: doc.space.name,
          background: doc.space.background,
          nodes: doc.nodes,
          items: doc.items,
        })
        const vp = doc.space.viewport
        // La toile se monte après `loadDoc` : on attend sa taille réelle avant d'ajuster.
        for (let i = 0; i < 30 && useCamera.getState().view.w <= 1; i++) {
          await new Promise((r) => requestAnimationFrame(() => r(null)))
        }
        if (!alive) return
        const view = useCamera.getState().view
        const cam =
          vp.x === 0 && vp.y === 0 && vp.zoom === 1 && doc.nodes.length > 0
            ? fitBox(view, unionRect(doc.nodes.map(aabb))!, 64, 1)
            : vp
        setCamera(cam, { settle: true })
        if (consumePendingRename(uuid)) setTimeout(() => titleRef.current?.edit(), 50)
      } catch (err) {
        if (!alive) return
        if (err instanceof RpcError && err.code === 'not_found') {
          toast(tr.spacesUi.notFound)
          back()
        } else fail(err)
      }
    })()
    return () => {
      alive = false
      commitEditing()
      void persistence.flush()
    }
  }, [uuid])

  // Démontage complet de l'éditeur : état vidé.
  useEffect(() => () => resetStore(), [])

  // Vidage : handshake de fermeture, blur, masquage, beforeunload.
  useEffect(() => {
    const offFlush = registerFlush(async () => {
      commitEditing()
      await persistence.flush()
    })
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void persistence.flush()
    }
    const onBlur = () => void persistence.flush()
    const onUnload = () => {
      commitEditing()
      persistence.flushSync()
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('blur', onBlur)
    window.addEventListener('beforeunload', onUnload)
    void initKeymap()
    const onFocus = () => void initKeymap()
    window.addEventListener('focus', onFocus)
    return () => {
      offFlush()
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // Clavier, commandes du menu, presse-papiers.
  useEffect(() => {
    let spaceDownAt = 0
    let panned = false
    const blocked = (e: Event) =>
      Boolean(useUi.getState().overlay) ||
      isEditableTarget(e.target) ||
      isEditableTarget(document.activeElement) ||
      useSpace.getState().editingId !== null
    const onKey = (e: KeyboardEvent) => {
      if (blocked(e)) return
      if (e.key === ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        if (!e.repeat) {
          spaceDownAt = performance.now()
          panned = false
          setSpaceHeld(true)
        }
        return
      }
      if (e.key.startsWith('Arrow') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        if (useSpace.getState().selection.length > 0) {
          e.preventDefault()
          nudge(dx, dy)
        }
        return
      }
      if (e.key === 'Enter' && !e.metaKey) {
        e.preventDefault()
        editSelected()
        return
      }
      const id = resolveShortcut(e)
      if (!id) return
      const st = useSpace.getState()
      const hasSel = st.selection.length > 0
      const handled = ((): boolean => {
        switch (id) {
          case 'tool.select':
            setTool('select')
            return true
          case 'tool.hand':
            setTool('hand')
            return true
          case 'tool.note':
            setTool('note')
            return true
          case 'tool.text':
            setTool('text')
            return true
          case 'tool.rect':
            setTool('rect')
            return true
          case 'tool.ellipse':
            setTool('ellipse')
            return true
          case 'tool.image':
            document.querySelector<HTMLInputElement>('[data-testid="space-file-input"]')?.click()
            return true
          case 'drawer':
            useSpace.setState((s) => ({ drawerOpen: !s.drawerOpen }))
            return true
          case 'undo':
          case 'redo':
          case 'redoAlt':
          case 'selectAll':
          case 'zoomIn':
          case 'zoomOut':
          case 'zoom100':
            return runCommand(id)
          case 'deselect':
            if (st.selection.length === 0 && st.tool === 'select') return false
            useSpace.setState({ selection: [], tool: 'select' })
            return true
          case 'duplicate':
            duplicateSelection()
            return true
          case 'delete':
          case 'deleteForward':
            if (!hasSel) return false
            deleteSelection()
            return true
          case 'bringForward':
            reorderSelection('forward')
            return true
          case 'sendBackward':
            reorderSelection('backward')
            return true
          case 'bringToFront':
            reorderSelection('front')
            return true
          case 'sendToBack':
            reorderSelection('back')
            return true
          case 'lock':
            toggleLock()
            return true
          case 'alignLeft':
            alignSelection('left')
            return true
          case 'alignRight':
            alignSelection('right')
            return true
          case 'alignTop':
            alignSelection('top')
            return true
          case 'alignBottom':
            alignSelection('bottom')
            return true
          case 'alignCenterH':
            alignSelection('hcenter')
            return true
          case 'alignCenterV':
            alignSelection('vcenter')
            return true
          case 'distributeH':
            distributeSelection('h')
            return true
          case 'distributeV':
            distributeSelection('v')
            return true
          case 'fitAll':
            fitAll()
            return true
          case 'fitSelection':
            fitSelection()
            return true
          default:
            // ⌘C / ⌘X / ⌘V : événements DOM `copy` / `cut` / `paste` (rôles du menu Édition).
            return false
        }
      })()
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ') return
      setSpaceHeld(false)
      if (!panned && performance.now() - spaceDownAt < 250 && !blocked(e)) quickLookSelection()
    }
    const onPointer = (e: PointerEvent) => {
      if (e.buttons !== 0) panned = true
    }
    const onCopy = (e: ClipboardEvent) => {
      if (blocked(e) || useSpace.getState().selection.length === 0) return
      e.preventDefault()
      void copySelection(false)
    }
    const onCut = (e: ClipboardEvent) => {
      if (blocked(e) || useSpace.getState().selection.length === 0) return
      e.preventDefault()
      void copySelection(true)
    }
    const onPaste = (e: ClipboardEvent) => {
      if (blocked(e)) return
      e.preventDefault()
      void pasteClipboard()
    }
    const offBus = on('space.command', ({ cmd }) => {
      if (useSpace.getState().editingId) return
      fromMenu = true
      try {
        runCommand(cmd)
      } finally {
        fromMenu = false
      }
    })
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('pointermove', onPointer)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      offBus()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('pointermove', onPointer)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }, [])

  const rename = (next: string) => setName(next)

  // Dépôt : éléments de la bibliothèque (tiroir, glisser natif interne) ou fichiers du Finder.
  const [dropping, setDropping] = useState(false)
  const onDragOver = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types)
    if (useUi.getState().internalDrag || types.includes(ITEMS_MIME) || isExternalDrag(types)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDropping(true)
    }
  }
  const onDrop = (e: React.DragEvent) => {
    setDropping(false)
    const at = viewport.current?.clientToWorld(e.clientX, e.clientY)
    const raw = e.dataTransfer.getData(ITEMS_MIME)
    const internal = useUi.getState().internalDrag
    let uuids: string[] = []
    if (raw) {
      try {
        uuids = (JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === 'string')
      } catch {
        uuids = []
      }
    } else if (internal) uuids = internal
    if (uuids.length > 0) {
      e.preventDefault()
      useUi.getState().clearInternalDrag()
      void cardsFor(uuids).then((cards) => addItemsAt(cards, at))
      return
    }
    if (!isExternalDrag(Array.from(e.dataTransfer.types))) return
    e.preventDefault()
    const drop = readDrop(e.dataTransfer, (f) => window.recolt?.pathForFile(f) ?? '')
    if (drop.paths.length > 0) {
      void addFilesAt(drop.paths, at)
      return
    }
    const files = Array.from(e.dataTransfer.files).slice(0, 200)
    void Promise.all(
      files.map(async (f) => {
        try {
          return await rpc('spaces.addAssetBuffer', {
            spaceUuid: uuid,
            bytes: new Uint8Array(await f.arrayBuffer()),
            mime: f.type || 'application/octet-stream',
          })
        } catch (err) {
          fail(err)
          return null
        }
      }),
    ).then((assets) =>
      placeAssetsAt(
        assets.filter((a) => a !== null),
        at,
      ),
    )
  }

  return (
    <>
      <div
        data-testid="space-subheader"
        className="flex h-[61px] shrink-0 items-center justify-between border-b border-border-subtle pl-8 pr-[34px]"
      >
        <div className="flex min-w-0 items-center">
          <button
            type="button"
            data-testid="space-back"
            aria-label={tr.spacesUi.back}
            className="ml-px flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-border text-fg-subtle transition-colors hover:bg-surface"
            onClick={back}
          >
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>
          <div className="ml-[11px] min-w-0" data-testid="space-title">
            <InlineEditableTitle
              ref={titleRef}
              value={name || tr.spaces.untitled}
              label={tr.spacesUi.titleLabel}
              onCommit={rename}
            />
          </div>
          <Menu.Dropdown.Root>
            <Menu.Dropdown.Trigger asChild>
              <button
                type="button"
                data-testid="space-more"
                aria-label={tr.spacesUi.moreActions}
                className="ml-3 flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-[var(--hover)]"
              >
                <Ellipsis size={18} strokeWidth={1.75} />
              </button>
            </Menu.Dropdown.Trigger>
            <Menu.Dropdown.Content align="start" data-testid="space-menu">
              <Menu.Dropdown.Item icon={<Pencil />} onSelect={() => titleRef.current?.edit()}>
                {tr.spaces.rename}
              </Menu.Dropdown.Item>
              <Menu.Dropdown.Sub>
                <Menu.Dropdown.SubTrigger icon={<Grid3x3 />}>
                  {tr.spacesUi.background}
                </Menu.Dropdown.SubTrigger>
                <Menu.Dropdown.SubContent>
                  {(['dots', 'grid', 'plain'] as const).map((b) => (
                    <Menu.Dropdown.CheckboxItem
                      key={b}
                      checked={background === b}
                      onSelect={() => setBackground(b)}
                    >
                      {tr.spacesUi.backgrounds[b]}
                    </Menu.Dropdown.CheckboxItem>
                  ))}
                </Menu.Dropdown.SubContent>
              </Menu.Dropdown.Sub>
              <Menu.Dropdown.Item
                icon={<Download />}
                data-testid="space-export"
                onSelect={() => setTimeout(() => setExportOpen(true), 0)}
              >
                {tr.spacesExtra.exportMenu}
              </Menu.Dropdown.Item>
              <Menu.Dropdown.Item
                icon={<Copy />}
                onSelect={() =>
                  void persistence.flush().then(() => duplicateSpace(uuid, name, true))
                }
              >
                {tr.spaces.duplicate}
              </Menu.Dropdown.Item>
              <Menu.Dropdown.Item
                tone="danger"
                icon={<Trash />}
                data-testid="space-delete"
                onSelect={() => void deleteSpaceWithConfirm(uuid, name, back)}
              >
                {tr.spaces.delete}
              </Menu.Dropdown.Item>
            </Menu.Dropdown.Content>
          </Menu.Dropdown.Root>
          <ExportPopover
            open={exportOpen}
            onOpenChange={setExportOpen}
            spaceUuid={uuid}
            name={name}
          />
        </div>
      </div>
      <div
        className="relative min-h-0 flex-1"
        data-testid="space-editor"
        data-dropping={dropping ? '1' : undefined}
        onDragOver={onDragOver}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        {loaded ? (
          <CanvasContextMenu at={menuAt.at} nodeId={menuAt.nodeId}>
            <Viewport
              handleRef={viewport}
              spaceHeld={spaceHeld}
              onDoubleClickNode={(id) => {
                const n = useSpace.getState().nodes[id]
                if (!n || n.locked) return
                if (n.type === 'item') {
                  setSelectionOne(id)
                  quickLookSelection()
                } else if (n.type === 'note' || n.type === 'text' || n.type === 'shape') {
                  useSpace.setState({ selection: [id], editingId: id })
                }
              }}
              onDoubleClickEmpty={(at) => {
                if (useSpace.getState().tool === 'select') createAt('text', at)
              }}
              onContextMenuAt={(at, nodeId) => setMenuAt({ at, nodeId })}
            />
          </CanvasContextMenu>
        ) : null}
        {loaded ? (
          <>
            <ToolDock />
            <ZoomCluster />
            <StyleBar />
            {drawerOpen ? <LibraryDrawer spaceUuid={uuid} /> : null}
          </>
        ) : null}
        <input
          type="file"
          multiple
          hidden
          data-testid="space-file-input"
          accept="image/*,video/mp4,video/quicktime,video/webm,.heic,.heif,.tif,.tiff"
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? [])
            const paths = files.map((f) => window.recolt?.pathForFile(f) ?? '').filter(Boolean)
            e.currentTarget.value = ''
            if (paths.length > 0) void addFilesAt(paths)
          }}
        />
      </div>
    </>
  )
}

function setSelectionOne(id: string) {
  useSpace.setState({ selection: [id] })
}

export default function SpaceEditor() {
  const route = useUi((s) => s.route)
  if (route.name !== 'space') return null
  return <EditorView key={route.uuid} uuid={route.uuid} />
}
