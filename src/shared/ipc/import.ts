/**
 * Contrat `import.gatheros.*` (ARCHI §6). GatherOS en lecture seule, copie de la base (PLAN §2.2).
 */
import { z } from 'zod'
import { LibraryId } from '../enums'
import { Empty, Void, type ContractShape, type EventShape } from './define'

export const ImportPhase = z.enum([
  'detect',
  'snapshot',
  'plan',
  'authors',
  'items',
  'files',
  'collections',
  'tags',
  'tombstones',
  'jobs',
  'finalize',
  'done',
])

export const ImportOptions = z.object({
  includeTrash: z.boolean().default(true),
  includeHidden: z.boolean().default(true),
  importSpaces: z.boolean().default(true),
})

export const ImportProgress = z.object({
  runId: z.number().int(),
  phase: ImportPhase,
  done: z.number().int(),
  total: z.number().int(),
  message: z.string().nullable(),
})
export type ImportProgress = z.output<typeof ImportProgress>

export const ImportReport = z.object({
  runId: z.number().int(),
  state: z.enum(['running', 'files_done', 'done', 'failed', 'cancelled']),
  startedAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
  /** Compteurs par entité (items, media, files, collections, memberships, tags, skipped…). */
  counts: z.record(z.string(), z.number().int()),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
})
export type ImportReport = z.output<typeof ImportReport>

export const importContract = {
  'import.gatheros.detect': {
    input: Empty,
    output: z.object({
      found: z.boolean(),
      path: z.string().nullable(),
      running: z.boolean(),
      schemaVersion: z.number().int().nullable(),
      counts: z
        .object({ items: z.number().int(), collections: z.number().int(), tags: z.number().int() })
        .nullable(),
    }),
  },
  'import.gatheros.start': {
    input: z.object({ libraryId: LibraryId.optional(), options: ImportOptions.prefault({}) }),
    output: z.object({ runId: z.number().int() }),
  },
  'import.gatheros.cancel': { input: Empty, output: Void },
  'import.gatheros.lastReport': { input: Empty, output: ImportReport.nullable() },
} as const satisfies ContractShape

export const importEvents = {
  'import.progress': ImportProgress,
} as const satisfies EventShape
