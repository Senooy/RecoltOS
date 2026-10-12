/**
 * Renderer-side import: report « N added · M duplicates · 0 failed »,
 * `ingest.progress` progress in the pill, pickers (files / folder), ⌘V (the main reads the
 * clipboard), URL.
 */
import { create } from 'zustand'
import type { IngestReport } from '../../../../shared/dto/items'
import { toast } from '../../components/ui'
import { tr } from '../../i18n'
import { RpcError, rpc } from '../../lib/rpc'
import { openViewerByUuid } from '../viewer/open'

export const useImportUi = create<{ urlOpen: boolean; setUrlOpen: (o: boolean) => void }>()(
  (set) => ({ urlOpen: false, setUrlOpen: (urlOpen) => set({ urlOpen }) }),
)

/** Report toast; a single item added → « View » opens the detail view. */
export function reportImport(r: IngestReport | null): void {
  if (!r) return
  const total = r.added.length + r.duplicates.length + r.failed.length
  if (total === 0) return
  const single = r.added.length === 1 && total === 1 ? r.added[0]!.itemUuid : null
  const msg = tr.importUiMore.report(r.added.length, r.duplicates.length, r.failed.length)
  if (single)
    toast(msg, { action: { label: tr.captureUi.view, onClick: () => openViewerByUuid(single) } })
  else toast(msg)
}

function fail(err: unknown): void {
  toast(err instanceof RpcError ? err.message : tr.errors.generic)
}

const target = (collectionUuid?: string) => (collectionUuid ? { collectionUuid } : {})

export async function importPaths(paths: string[], collectionUuid?: string): Promise<void> {
  try {
    reportImport(await rpc('ingest.files', { paths, ...target(collectionUuid) }))
  } catch (err) {
    fail(err)
  }
}

export async function importFolder(collectionUuid?: string): Promise<void> {
  try {
    reportImport(await rpc('ingest.pickFolder', target(collectionUuid)))
  } catch (err) {
    fail(err)
  }
}

export async function importUrl(url: string, collectionUuid?: string): Promise<IngestReport> {
  return rpc('ingest.url', { url, ...target(collectionUuid) })
}

export async function pasteFromClipboard(collectionUuid?: string): Promise<void> {
  try {
    const r = await rpc('ingest.clipboard', target(collectionUuid))
    if (!r) toast(tr.importUiMore.nothingToPaste)
    else reportImport(r)
  } catch (err) {
    fail(err)
  }
}
