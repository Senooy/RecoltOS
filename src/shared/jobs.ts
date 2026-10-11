/**
 * File de jobs unique (PLAN §1.3, §4.2) : table `jobs`, convention `priority DESC`.
 */
import { z } from 'zod'

/** Priorités : plus grand = plus urgent. */
export const JOB_PRIORITY = {
  MANUAL: 100,
  INTERACTIVE: 80,
  SYNC: 60,
  IMPORT_HIGH: 50,
  BATCH: 20,
  BACKGROUND: 10,
} as const
export type JobPriority = (typeof JOB_PRIORITY)[keyof typeof JOB_PRIORITY]

export const JOB_TYPES = [
  'media.derive',
  'media.preview',
  'media.download',
  'remote.fetch',
  'avatar.fetch',
  'ai.enrich',
  'ai.prompt',
  'purge.files',
] as const
export const JobType = z.enum(JOB_TYPES)
export type JobType = z.output<typeof JobType>

export const JobState = z.enum(['queued', 'running', 'done', 'failed', 'cancelled'])
export type JobState = z.output<typeof JobState>

/** Charge utile commune : `failedOn[]` garde les fournisseurs/CDN déjà tentés. */
export const JobPayloadBase = z.looseObject({
  failedOn: z.array(z.string()).default([]),
})
export type JobPayloadBase = z.output<typeof JobPayloadBase>

/** Ligne de `jobs` telle que la voit un handler. */
export interface JobRecord {
  id: number
  type: JobType
  itemId: number | null
  dedupeKey: string | null
  payload: JobPayloadBase & Record<string, unknown>
  state: JobState
  priority: number
  attempts: number
  maxAttempts: number
  runAfter: number
  batchId: number | null
  provider: string | null
}

export interface JobError {
  code: string
  message: string
}

/** Résultat d'un handler : la file applique l'état (done / nouvelle tentative / échec). */
export type JobOutcome =
  | { status: 'done' }
  | { status: 'retry'; retryAt: number; error: JobError }
  | { status: 'failed'; error: JobError }
  /** Remis en file à `retryAt` SANS consommer de tentative (budget, fournisseur indisponible). */
  | { status: 'defer'; retryAt: number; error?: JobError }

export const JobsByTypeStatus = z.object({
  queued: z.number().int(),
  running: z.number().int(),
  failed: z.number().int(),
  pausedUntil: z.number().int().nullable(),
})
export const JobsStatus = z.object({
  byType: z.record(z.string(), JobsByTypeStatus),
})
export type JobsStatus = z.output<typeof JobsStatus>
