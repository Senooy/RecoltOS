/**
 * Domaine `import-ux` : « Ouvrir avec RecoltOS », dépôt sur l'icône du Dock, fichiers passés
 * à une seconde instance (`onOpenFiles` de `bootstrap/open-files.ts`).
 */
import type { ServiceContext } from '../bootstrap/context'
import { onOpenFiles } from '../bootstrap/open-files'
import { ingestPaths } from '../ingest/files'
import { ingestDeps } from '../ipc/handlers/ingest'
import { emitIngestProgress } from '../jobs/runtime'
import { ensureMainWindow } from '../windows/main-window'
import { requestOpenItem } from '../nav'
import { createOpenFileBatcher } from './open-file'

export function initImportUx(ctx: ServiceContext): () => void {
  const batcher = createOpenFileBatcher({
    ensureWindow: ensureMainWindow,
    importPaths: (paths) => ingestPaths(paths, {}, ingestDeps(), emitIngestProgress),
    openItem: requestOpenItem,
    log: ctx.log,
  })
  return onOpenFiles((paths) => batcher.push(paths))
}
