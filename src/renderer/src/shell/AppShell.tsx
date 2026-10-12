/**
 * App shell: 96 px header (drag region only without an overlay),
 * library selector, central segmented control, right group, current screen (`routes.tsx`),
 * overlays (Settings…), FAB, drop overlay, selection bar, toasts, dialogs. Commands from the
 * native menu (`evt:menu.command`) and keyboard fallbacks (⌘1/2/3 by `e.code`, Esc).
 */
import { Suspense, useEffect, useState } from 'react'
import { EmptyState, Toaster, TooltipProvider, toast } from '../components/ui'
import { tr } from '../i18n'
import { cn } from '../lib/cn'
import { isDigit } from '../lib/shortcuts'
import { isNotImplemented, rpc, subscribe } from '../lib/rpc'
import { flattenTree, followCollections, useCollections } from '../state/collections'
import { useUi, type Route } from '../state/ui'
import { useUndo } from '../state/undo'
import { Dialogs } from './Dialogs'
import { AiDialogs } from '../features/ai/AiDialogs'
import { DropOverlay } from './DropOverlay'
import { CollectionsDragPanel } from '../features/grid/CollectionsDragPanel'
import { FabMenu } from './FabMenu'
import { HeaderActions } from './HeaderActions'
import { LibraryPicker } from './LibraryPicker'
import { NavSegmented, type NavValue } from './NavSegmented'
import { isRouteImplemented, overlays, routes } from './routes'
import { SelectionBar } from './SelectionBar'
import type { MenuCommand } from '../../../shared/shortcuts'
import { importFiles, openRediscover, runMenuCommand, toggleTheme } from './commands'
import { openViewerByUuid } from '../features/viewer/open'
import { CaptureFeedback } from '../features/capture/CaptureFeedback'
import { runCapture } from '../features/capture/capture-actions'
import { importFolder } from '../features/import/import-actions'
import { IngestProgress } from '../features/import/IngestProgress'
import { usePaste } from '../features/import/usePaste'

/** The import resume is offered only once per launch (the shell remounts on language change). */
let resumeOffered = false

const navOf = (r: Route): NavValue =>
  r.name === 'search'
    ? 'search'
    : r.name === 'collection' || r.name === 'shelf'
      ? 'collections'
      : r.name === 'spaces' || r.name === 'space'
        ? 'spaces'
        : 'library'

const routeOf = (v: NavValue): Route =>
  v === 'search'
    ? { name: 'search' }
    : v === 'collections'
      ? { name: 'shelf' }
      : v === 'spaces'
        ? { name: 'spaces' }
        : { name: 'library' }

function useWindowWidth(): number {
  const [w, setW] = useState(() => window.innerWidth)
  useEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}

export function AppShell({ dark }: { dark: boolean }) {
  const route = useUi((s) => s.route)
  const overlay = useUi((s) => s.overlay)
  const navigate = useUi((s) => s.navigate)
  const openOverlay = useUi((s) => s.openOverlay)
  const width = useWindowWidth()
  usePaste()

  useEffect(() => {
    void useCollections.getState().load()
    const offs = [
      followCollections(),
      subscribe('menu.command', ({ cmd }) => runMenuCommand(cmd)),
      // Capture notification, "Open with", single-file import: detail view.
      subscribe('nav.openItem', ({ uuid }) => {
        void rpc('system.takePendingNav').catch(() => undefined)
        openViewerByUuid(uuid)
      }),
      subscribe('library.switched', () => {
        useUi.getState().clearSelection()
        useUndo.getState().clear()
      }),
    ]
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (useUi.getState().selection.length > 0) useUi.getState().clearSelection()
        return
      }
      // ⌘1/2/3 fallback by position (AZERTY), if the menu did not consume the key.
      if (e.metaKey && !e.shiftKey && !e.altKey) {
        const map: [number, MenuCommand][] = [
          [1, 'goLibrary'],
          [2, 'goCollections'],
          [3, 'goSpaces'],
        ]
        for (const [n, cmd] of map) {
          if (isDigit(e, n)) {
            e.preventDefault()
            runMenuCommand(cmd)
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    // Window recreated by "Open with" or a notification: pending item.
    void rpc('system.takePendingNav')
      .then((p) => {
        if (p) openViewerByUuid(p.uuid)
      })
      .catch(() => undefined)
    return () => {
      offs.forEach((o) => o())
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Interrupted import: resume offered at launch.
  useEffect(() => {
    if (resumeOffered) return
    resumeOffered = true
    void rpc('import.gatheros.pending')
      .then((p) => {
        if (p) {
          toast(tr.importUi.resumeTitle, {
            action: {
              label: tr.importUi.resume,
              onClick: () => openOverlay({ type: 'settings', section: 'libraries' }),
            },
            duration: 15_000,
          })
        }
      })
      .catch((err: unknown) => {
        if (!isNotImplemented(err)) console.warn('[import] unknown state', err)
      })
  }, [openOverlay])

  const Screen = routes[route.name]
  const implemented = isRouteImplemented(route.name)
  const showFab = route.name === 'library' || route.name === 'collection' || route.name === 'search'
  const Overlay = overlay ? overlays[overlay.type] : null
  const collection =
    route.name === 'collection'
      ? (flattenTree(useCollections.getState().tree).find((f) => f.node.uuid === route.uuid)
          ?.node ?? null)
      : null

  // Shelf: full-frame black, header reduced to the traffic lights and the dark segmented control.
  const immersive = route.name === 'shelf' && implemented
  return (
    <TooltipProvider>
      <div
        data-testid="app-shell"
        data-immersive={immersive ? 'shelf' : undefined}
        className={cn('flex h-full flex-col text-fg', immersive ? 'bg-[var(--shelf-bg)]' : 'bg-bg')}
      >
        <header
          data-testid="header"
          className={cn('relative z-10 h-24 shrink-0', overlay === null && 'app-drag')}
        >
          {immersive ? null : <LibraryPicker />}
          <NavSegmented
            value={navOf(route)}
            tone={immersive ? 'dark' : 'light'}
            onChange={(v) =>
              v === 'search' ? useUi.getState().openSearch() : navigate(routeOf(v))
            }
          />
          {immersive ? null : (
            <HeaderActions
              compact={width < 1100}
              dark={dark}
              onSearch={() => useUi.getState().openOverlay({ type: 'palette' })}
              onRediscover={openRediscover}
              onToggleTheme={toggleTheme}
              onSettings={() => openOverlay({ type: 'settings' })}
            />
          )}
        </header>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {implemented ? (
            <Suspense fallback={null}>
              <Screen />
            </Suspense>
          ) : (
            <div className="flex flex-1 items-center justify-center border-t border-border-subtle">
              <EmptyState title={tr.shell.unavailable} />
            </div>
          )}
        </div>
        {showFab ? (
          <FabMenu
            collection={collection ? { uuid: collection.uuid, name: collection.name } : null}
            onImportFiles={() =>
              void importFiles(route.name === 'collection' ? route.uuid : undefined)
            }
            onImportFolder={() =>
              void importFolder(route.name === 'collection' ? route.uuid : undefined)
            }
            onCapture={() => void runCapture()}
          />
        ) : null}
        <IngestProgress />
        <CaptureFeedback />
        <SelectionBar />
        <CollectionsDragPanel />
        <DropOverlay
          collection={collection ? { uuid: collection.uuid, name: collection.name } : null}
        />
        {Overlay ? (
          <Suspense fallback={null}>
            <Overlay />
          </Suspense>
        ) : null}
        <Dialogs />
        <AiDialogs />
        <Toaster />
      </div>
    </TooltipProvider>
  )
}
