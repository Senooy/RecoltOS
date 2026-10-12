/**
 * "Open with RecoltOS" / drop on the Dock icon: paths received by
 * `open-file` (queued BEFORE `ready` by `bootstrap/pre-ready.ts`) are grouped for 250 ms, the
 * window is recreated if it was closed, then imported; a single item → detail view.
 */
import type { IngestReport } from '../../shared/dto/items'

export const OPEN_FILE_BATCH_MS = 250

export interface OpenFileDeps {
  ensureWindow: () => Promise<{ show(): void; focus(): void }>
  importPaths: (paths: string[]) => Promise<IngestReport>
  openItem: (uuid: string) => void
  log?: { warn: (...a: unknown[]) => void }
}

export function createOpenFileBatcher(deps: OpenFileDeps, delayMs = OPEN_FILE_BATCH_MS) {
  const pending: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let chain: Promise<void> = Promise.resolve()

  const flush = async () => {
    const batch = pending.splice(0)
    if (batch.length === 0) return
    try {
      const w = await deps.ensureWindow()
      w.show()
      w.focus()
      const r = await deps.importPaths(batch)
      const items = [...r.added, ...r.duplicates]
      if (items.length === 1) deps.openItem(items[0]!.itemUuid)
    } catch (err) {
      deps.log?.warn('[open-file] import impossible', err)
    }
  }

  return {
    push(paths: string[]) {
      pending.push(...paths)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        chain = chain.then(flush)
      }, delayMs)
    },
    /** Waits for the end of the current batch (tests). */
    idle: () => chain,
  }
}
