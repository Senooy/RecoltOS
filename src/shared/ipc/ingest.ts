/**
 * Contrat `ingest.*` : `files` dès M1 ; `pickFiles`, `pickFolder`, `url`, `clipboard` en M3.
 */
import { z } from 'zod'
import { IngestProgress, IngestReport } from '../dto/items'
import { Uuid, WebUrl } from '../enums'
import { AbsPath, type ContractShape, type EventShape } from './define'

const Target = { collectionUuid: Uuid.optional() }

export const ingestContract = {
  'ingest.files': {
    input: z.object({ paths: z.array(AbsPath).min(1).max(10_000), ...Target }),
    output: IngestReport,
  },
  /** `null` si l'utilisateur annule le sélecteur. */
  'ingest.pickFiles': { input: z.object(Target).default({}), output: IngestReport.nullable() },
  'ingest.pickFolder': { input: z.object(Target).default({}), output: IngestReport.nullable() },
  'ingest.url': { input: z.object({ url: WebUrl, ...Target }), output: IngestReport },
  'ingest.clipboard': { input: z.object(Target).default({}), output: IngestReport.nullable() },
} as const satisfies ContractShape

export const ingestEvents = {
  'ingest.progress': IngestProgress,
} as const satisfies EventShape
