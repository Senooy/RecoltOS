/**
 * Page Bibliothèque (DESIGN §3.1, WP-15) : sous-barre (onglets, « Vider la corbeille », curseur de
 * colonnes, tri), rangée de collections (Tout et Enregistrés), grille masonry ; états vides
 * (DESIGN §3.12) et squelette de chargement.
 */
import { Download, FileUp } from 'lucide-react'
import { useRef, useState } from 'react'
import type { LibraryTab, SortMode } from '../../../../shared/enums'
import { Button, EmptyState, toast } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { RpcError, rpc } from '../../lib/rpc'
import { importFiles } from '../../shell/commands'
import { useCollections } from '../../state/collections'
import { askConfirm } from '../../state/dialogs'
import { usePrefs } from '../../state/prefs'
import { clampColumns, useUi } from '../../state/ui'
import { MasonryGrid } from '../grid/MasonryGrid'
import { CollectionsRow } from './CollectionsRow'
import { LibraryTabs } from './LibraryTabs'
import { ColumnSlider } from './ColumnSlider'
import { SortMenu } from './SortMenu'
import { useLibraryItems } from './useLibraryItems'

/** Hauteurs relatives des cartes squelette (DESIGN §3.12). */
const SKELETON_RATIOS = [1.2, 0.8, 1.5, 1, 0.75, 1.3, 0.9, 1.25, 1.4, 0.7, 1.1, 0.85]

function GridSkeleton({ columns }: { columns: number }) {
  const cols: number[][] = Array.from({ length: columns }, () => [])
  SKELETON_RATIOS.forEach((r, i) => cols[i % columns]?.push(r))
  return (
    <div data-testid="grid-skeleton" className="flex gap-2 px-[18px]">
      {cols.map((col, c) => (
        <div key={c} className="flex min-w-0 flex-1 flex-col gap-2">
          {col.map((r, i) => (
            <div
              key={i}
              className="skeleton w-full rounded-md"
              style={{ aspectRatio: `1 / ${r}`, animationDelay: `${(c * 3 + i) * 80}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function EmptyTab({ tab, libraryEmpty }: { tab: LibraryTab; libraryEmpty: boolean }) {
  const openOverlay = useUi((s) => s.openOverlay)
  if (tab === 'all' && libraryEmpty) {
    return (
      <EmptyState
        className="pt-24"
        title={fr.empty.libraryTitle}
        description={fr.empty.libraryBody}
        action={
          <div className="mt-4 flex gap-2">
            <Button
              variant="primary"
              icon={<Download size={15} />}
              data-testid="empty-import-gatheros"
              onClick={() => openOverlay({ type: 'settings', section: 'libraries' })}
            >
              {fr.empty.importGatheros}
            </Button>
            <Button
              variant="secondary"
              icon={<FileUp size={15} />}
              onClick={() => void importFiles()}
            >
              {fr.empty.importFiles}
            </Button>
          </div>
        }
      />
    )
  }
  const title =
    tab === 'trash'
      ? fr.empty.trash
      : tab === 'hidden'
        ? fr.empty.hidden
        : tab === 'unsorted'
          ? fr.empty.unsorted
          : tab === 'saved'
            ? fr.libraryUi.emptySaved
            : fr.empty.libraryTitle
  return <EmptyState className="pt-24" title={title} />
}

export default function LibraryPage() {
  const tab = useUi((s) => s.libraryTab)
  const setTab = useUi((s) => s.setLibraryTab)
  const defaultColumns = usePrefs((s) => s.prefs.defaultColumns)
  const defaultSort = usePrefs((s) => s.prefs.defaultSort)
  const columns = useUi((s) => s.columns.library) ?? clampColumns(defaultColumns)
  const setColumns = useUi((s) => s.setColumns)
  const [sort, setSort] = useState<SortMode | null>(null)
  const [seed] = useState(() => Math.floor(Math.random() * 1_000_000))
  const effectiveSort = sort ?? defaultSort
  const { items, loaded, total } = useLibraryItems(tab, effectiveSort, seed)
  const tree = useCollections((s) => s.tree)
  const scrollRef = useRef<HTMLElement | null>(null)
  const showCollections = tab === 'all' || tab === 'saved'

  const emptyTrash = async () => {
    const ok = await askConfirm({
      title: fr.confirm.emptyTrashTitle,
      body: fr.confirm.emptyTrashBody(total),
      confirmLabel: fr.tabs.emptyTrash,
      danger: true,
    })
    if (!ok) return
    try {
      await rpc('items.emptyTrash')
    } catch (err) {
      toast(err instanceof RpcError ? err.message : fr.errors.generic)
    }
  }

  return (
    <>
      <div
        data-testid="subheader"
        className="flex h-[61px] shrink-0 items-center justify-between border-b border-border-subtle pl-8 pr-[34px]"
      >
        <LibraryTabs value={tab} onChange={setTab} />
        <div className="flex items-center gap-5">
          {tab === 'trash' && total > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              data-testid="empty-trash"
              onClick={() => void emptyTrash()}
            >
              {fr.tabs.emptyTrash}
            </Button>
          ) : null}
          <ColumnSlider columns={columns} onChange={(n) => setColumns('library', n)} />
          <SortMenu value={effectiveSort} onChange={setSort} />
        </div>
      </div>
      <main
        ref={scrollRef}
        data-testid="library-scroll"
        className="relative min-h-0 flex-1 overflow-y-auto pb-[100px]"
        aria-label={fr.nav.library}
      >
        {showCollections && (tree.length > 0 || items.length > 0) ? (
          <CollectionsRow collections={tree} />
        ) : null}
        <div className="pt-5">
          {!loaded ? (
            <GridSkeleton columns={columns} />
          ) : items.length === 0 ? (
            <EmptyTab tab={tab} libraryEmpty={tab === 'all'} />
          ) : (
            <MasonryGrid
              items={items}
              columns={columns}
              scrollRef={scrollRef}
              context={tab === 'trash' ? 'trash' : tab === 'hidden' ? 'hidden' : 'library'}
            />
          )}
        </div>
      </main>
    </>
  )
}
