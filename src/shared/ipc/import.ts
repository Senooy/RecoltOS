/**
 * `import.gatheros.*` contract. GatherOS read-only, database copy.
 */
import { z } from 'zod'
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
export type ImportPhase = z.output<typeof ImportPhase>

export const ImportOptions = z.object({
  includeTrash: z.boolean().default(true),
  includeHidden: z.boolean().default(true),
  importSpaces: z.boolean().default(true),
  /** Examples shipped with GatherOS (tag `__starter__`), excluded by default. */
  skipStarterContent: z.boolean().default(true),
  /** Titles, descriptions, OCR and prompts. */
  importAiFields: z.boolean().default(true),
  /** GatherOS settings via allowlist; can never enable an AI provider. */
  importPrefs: z.boolean().default(false),
  /** Advanced: recreates what the user deleted since the last import. */
  ignoreTombstones: z.boolean().default(false),
})
export type ImportOptions = z.output<typeof ImportOptions>

/** Counts for the detection card, after excluding the starter examples. */
export const ImportPreview = z.object({
  items: z.number().int(),
  images: z.number().int(),
  videos: z.number().int(),
  posts: z.number().int(),
  links: z.number().int(),
  collections: z.number().int(),
  tags: z.number().int(),
  trash: z.number().int(),
  hidden: z.number().int(),
  starter: z.number().int(),
  bytes: z.number().int(),
})
export type ImportPreview = z.output<typeof ImportPreview>

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
  /** Counters per entity (items, media, files, collections, memberships, tags, skipped...). */
  counts: z.record(z.string(), z.number().int()),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
  /** Summary links: items without a file, duplicate URLs. */
  missingFiles: z.array(z.object({ itemUuid: z.string(), file: z.string() })).default([]),
  urlDuplicates: z.array(z.object({ url: z.string(), itemUuids: z.array(z.string()) })).default([]),
  /** Imported items without a description (button "Enrich N items with AI..."). */
  missingDescription: z.number().int().default(0),
  /** Full JSON report (`import/report-<ts>.json`), relative to the library. */
  reportRel: z.string().nullable().default(null),
})
export type ImportReport = z.output<typeof ImportReport>

export const importContract = {
  'import.gatheros.detect': {
    input: Empty,
    output: z.object({
      found: z.boolean(),
      path: z.string().nullable(),
      running: z.boolean(),
      /** Host name of the lock (`SingletonLock`) when GatherOS is running. */
      runningHost: z.string().nullable().default(null),
      schemaVersion: z.number().int().nullable(),
      libraryName: z.string().nullable().default(null),
      counts: ImportPreview.nullable(),
    }),
  },
  /** `libraryId` = source GatherOS library (default: GatherOS's active one). */
  'import.gatheros.start': {
    input: z.object({
      libraryId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,80}$/)
        .optional(),
      options: ImportOptions.prefault({}),
      /** `new`: first creates the "Imported from GatherOS" library and switches to it. */
      target: z.enum(['active', 'new']).default('active'),
    }),
    output: z.object({ runId: z.number().int() }),
  },
  'import.gatheros.cancel': { input: Empty, output: Void },
  'import.gatheros.lastReport': { input: Empty, output: ImportReport.nullable() },
  /** Interrupted import (`import_runs.state='running'`) to resume at launch. */
  'import.gatheros.pending': {
    input: Empty,
    output: z.object({ runId: z.number().int(), phase: z.string().nullable() }).nullable(),
  },
  'import.gatheros.revealReport': { input: Empty, output: Void },
} as const satisfies ContractShape

export const importEvents = {
  'import.progress': ImportProgress,
} as const satisfies EventShape
