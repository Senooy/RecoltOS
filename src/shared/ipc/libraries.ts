/** Contrat `libraries.*` (ERRATA §B, handler WP-02). Dossiers iCloud Drive / Dropbox refusés. */
import { z } from 'zod'
import { LibraryId } from '../enums'
import { AbsPath, Empty, Void, type ContractShape } from './define'

export const LibraryInfo = z.object({
  id: LibraryId,
  name: z.string(),
  /** `null` = emplacement par défaut `userData/libraries/<id>`. */
  path: z.string().nullable(),
  itemCount: z.number().int().min(0),
})
export type LibraryInfo = z.output<typeof LibraryInfo>

const Name = z.string().trim().min(1).max(100)

export const librariesContract = {
  'libraries.list': {
    input: Empty,
    output: z.object({ active: LibraryId, libraries: z.array(LibraryInfo) }),
  },
  'libraries.create': {
    input: z.object({ name: Name, path: AbsPath.optional() }),
    output: LibraryInfo,
  },
  'libraries.switch': { input: z.object({ id: LibraryId }), output: Void },
  /** Ouvre un dossier de bibliothèque existant ; `null` si annulé. */
  'libraries.openFolder': { input: Empty, output: LibraryInfo.nullable() },
  'libraries.rename': { input: z.object({ id: LibraryId, name: Name }), output: LibraryInfo },
  /** Les fichiers ne sont jamais supprimés depuis l'app (`deleteFiles: false`). */
  'libraries.remove': {
    input: z.object({ id: LibraryId, deleteFiles: z.literal(false) }),
    output: Void,
  },
  'libraries.reveal': { input: z.object({ id: LibraryId }), output: Void },
} as const satisfies ContractShape
