/** `libraries.*` contract (handler). iCloud Drive / Dropbox folders refused. */
import { z } from 'zod'
import { LibraryId } from '../enums'
import { AbsPath, Empty, Void, type ContractShape } from './define'

export const LibraryInfo = z.object({
  id: LibraryId,
  name: z.string(),
  /** `null` = default location `userData/libraries/<id>`. */
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
  /** Opens an existing library folder; `null` if cancelled. */
  'libraries.openFolder': { input: Empty, output: LibraryInfo.nullable() },
  'libraries.rename': { input: z.object({ id: LibraryId, name: Name }), output: LibraryInfo },
  /** Files are never deleted from the app (`deleteFiles: false`). */
  'libraries.remove': {
    input: z.object({ id: LibraryId, deleteFiles: z.literal(false) }),
    output: Void,
  },
  'libraries.reveal': { input: z.object({ id: LibraryId }), output: Void },
} as const satisfies ContractShape
