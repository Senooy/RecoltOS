/** Contrat `data.*` (ARCHI §2.3, §7) : export zip, instantanés, vérification, stockage. */
import { z } from 'zod'
import { Uuid } from '../enums'
import { Count, Empty, Void, type ContractShape, type EventShape } from './define'

export const SnapshotInfo = z.object({
  name: z.string(),
  createdAt: z.number().int(),
  bytes: z.number().int(),
  reason: z.string().nullable(),
})
export type SnapshotInfo = z.output<typeof SnapshotInfo>

const SnapshotName = z.string().regex(/^recolt-\d{8}-\d{6}(-[a-z0-9-]+)?\.db$/)

export const StorageBreakdown = z.object({
  items: z.number().int(),
  thumbs: z.number().int(),
  large: z.number().int(),
  posters: z.number().int(),
  previews: z.number().int(),
  display: z.number().int(),
  avatars: z.number().int(),
  remote: z.number().int(),
  spaces: z.number().int(),
  snapshots: z.number().int(),
  database: z.number().int(),
  total: z.number().int(),
  /** Originaux par type (somme de `item_media.file_size`), pour la barre empilée (DESIGN §3.10). */
  images: z.number().int().default(0),
  videos: z.number().int().default(0),
})

export const dataContract = {
  'data.exportZip': {
    input: z
      .object({ includeDerived: z.boolean().default(false), collectionUuid: Uuid.optional() })
      .default({ includeDerived: false }),
    output: z.union([z.object({ path: z.string() }), z.object({ cancelled: z.literal(true) })]),
  },
  'data.snapshot.create': {
    input: z.object({ reason: z.string().max(40).optional() }).default({}),
    output: SnapshotInfo,
  },
  'data.snapshot.list': { input: Empty, output: z.array(SnapshotInfo) },
  'data.snapshot.restore': { input: z.object({ name: SnapshotName }), output: Void },
  'data.snapshot.delete': { input: z.object({ name: SnapshotName }), output: Void },
  'data.verify': {
    input: Empty,
    output: z.object({
      ok: z.boolean(),
      issues: z.array(z.object({ code: z.string(), message: z.string(), count: z.number().int() })),
    }),
  },
  'data.storage': { input: Empty, output: StorageBreakdown },
  /** « Régénérer les aperçus » : `media.derive` pour chaque média présent (priorité de fond). */
  'data.regenerateDerived': { input: Empty, output: Count },
} as const satisfies ContractShape

export const dataEvents = {
  'export.progress': z.object({ bytesDone: z.number(), bytesTotal: z.number() }),
} as const satisfies EventShape
