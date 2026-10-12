/**
 * Handlers `import.gatheros.*` : détection (copie de la base, jamais la source),
 * lancement en tâche de fond (`import.progress`), annulation, rapport, import interrompu à reprendre.
 */
import { shell } from 'electron'
import { requireLibrary } from '../../library/library-context'
import {
  cancelGatherosImport,
  detectGatheros,
  lastReport,
  pending,
  startGatherosImport,
} from '../../importers/gatheros/service'
import type { DomainHandlers } from '../router'
import { AppError } from '../../../shared/errors'
import { mt } from '../../i18n'

export const importHandlers: DomainHandlers<'import'> = {
  'import.gatheros.detect': () => detectGatheros(),
  'import.gatheros.start': (input) =>
    startGatherosImport({
      ...(input.libraryId ? { libraryId: input.libraryId } : {}),
      options: input.options,
      target: input.target,
    }),
  'import.gatheros.cancel': () => {
    cancelGatherosImport()
  },
  'import.gatheros.lastReport': () => lastReport(),
  'import.gatheros.pending': () => pending(),
  'import.gatheros.revealReport': () => {
    const r = lastReport()
    if (!r?.reportRel) throw new AppError('not_found', mt().errors.noImportReport)
    shell.showItemInFolder(requireLibrary().paths.abs(r.reportRel))
  },
}
