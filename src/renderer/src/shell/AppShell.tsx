/**
 * Coque de l'app (DESIGN §2, WP-13) : en-tête 96 px (région de glisser seulement sans calque),
 * sélecteur de bibliothèque, segmented central, groupe de droite, écran courant (`routes.tsx`),
 * calques (Réglages…), FAB, calque de dépôt, barre de sélection, toasts, dialogues. Commandes du
 * menu natif (`evt:menu.command`) et replis clavier (⌘1/2/3 par `e.code`, Échap).
 */
import { Suspense, useEffect, useState } from 'react'
import { EmptyState, Toaster, TooltipProvider, toast } from '../components/ui'
import { fr } from '../i18n/fr'
import { cn } from '../lib/cn'
import { isDigit } from '../lib/shortcuts'
import { isNotImplemented, rpc, subscribe } from '../lib/rpc'
import { flattenTree, followCollections, useCollections } from '../state/collections'
import { useUi, type Route } from '../state/ui'
import { useUndo } from '../state/undo'
import { Dialogs } from './Dialogs'
import { DropOverlay } from './DropOverlay'
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
      // Notification de capture, « Ouvrir avec », import d'un seul fichier : vue détail.
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
      // Repli ⌘1/2/3 par position (AZERTY), si le menu n'a pas consommé la touche.
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
    // Fenêtre recréée par « Ouvrir avec » ou une notification : élément en attente.
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

  // Import interrompu : reprise proposée au lancement (ARCHI §6.9).
  useEffect(() => {
    void rpc('import.gatheros.pending')
      .then((p) => {
        if (p) {
          toast(fr.importUi.resumeTitle, {
            action: {
              label: fr.importUi.resume,
              onClick: () => openOverlay({ type: 'settings', section: 'libraries' }),
            },
            duration: 15_000,
          })
        }
      })
      .catch((err: unknown) => {
        if (!isNotImplemented(err)) console.warn('[import] état inconnu', err)
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

  // Étagère (DESIGN §3.4) : plein cadre noir, en-tête réduit aux feux et au segmented sombre.
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
              <EmptyState title={fr.shell.unavailable} />
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
        <DropOverlay
          collection={collection ? { uuid: collection.uuid, name: collection.name } : null}
        />
        {Overlay ? (
          <Suspense fallback={null}>
            <Overlay />
          </Suspense>
        ) : null}
        <Dialogs />
        <Toaster />
      </div>
    </TooltipProvider>
  )
}
