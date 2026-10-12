/**
 * Contrat `import.gatheros.*`. GatherOS en lecture seule, copie de la base.
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
  /** Exemples livrés par GatherOS (tag `__starter__`), exclus par défaut. */
  skipStarterContent: z.boolean().default(true),
  /** Titres, descriptions, OCR et prompts. */
  importAiFields: z.boolean().default(true),
  /** Réglages GatherOS par liste blanche ; ne peut jamais activer un fournisseur IA. */
  importPrefs: z.boolean().default(false),
  /** Avancé : recrée ce que l'utilisateur a supprimé depuis le dernier import. */
  ignoreTombstones: z.boolean().default(false),
})
export type ImportOptions = z.output<typeof ImportOptions>

/** Comptes de la carte de détection, après exclusion des exemples de démarrage. */
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
  /** Compteurs par entité (items, media, files, collections, memberships, tags, skipped…). */
  counts: z.record(z.string(), z.number().int()),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
  /** Liens du résumé : éléments sans fichier, doublons d'URL. */
  missingFiles: z.array(z.object({ itemUuid: z.string(), file: z.string() })).default([]),
  urlDuplicates: z.array(z.object({ url: z.string(), itemUuids: z.array(z.string()) })).default([]),
  /** Éléments importés sans description (bouton « Enrichir N éléments avec l'IA… »). */
  missingDescription: z.number().int().default(0),
  /** Rapport JSON complet (`import/report-<ts>.json`), relatif à la bibliothèque. */
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
      /** Nom d'hôte du verrou (`SingletonLock`) quand GatherOS tourne. */
      runningHost: z.string().nullable().default(null),
      schemaVersion: z.number().int().nullable(),
      libraryName: z.string().nullable().default(null),
      counts: ImportPreview.nullable(),
    }),
  },
  /** `libraryId` = bibliothèque GatherOS source (défaut : l'active de GatherOS). */
  'import.gatheros.start': {
    input: z.object({
      libraryId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,80}$/)
        .optional(),
      options: ImportOptions.prefault({}),
      /** `new` : crée d'abord la bibliothèque « Importée de GatherOS » et bascule dessus. */
      target: z.enum(['active', 'new']).default('active'),
    }),
    output: z.object({ runId: z.number().int() }),
  },
  'import.gatheros.cancel': { input: Empty, output: Void },
  'import.gatheros.lastReport': { input: Empty, output: ImportReport.nullable() },
  /** Import interrompu (`import_runs.state='running'`) à reprendre au lancement. */
  'import.gatheros.pending': {
    input: Empty,
    output: z.object({ runId: z.number().int(), phase: z.string().nullable() }).nullable(),
  },
  'import.gatheros.revealReport': { input: Empty, output: Void },
} as const satisfies ContractShape

export const importEvents = {
  'import.progress': ImportProgress,
} as const satisfies EventShape
