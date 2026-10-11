/**
 * Contrat d'un handler de job (file unique `jobs`, PLAN §1.3). Créé par WP-00.
 */
import { AppError } from '../../../shared/errors'
import type { JobOutcome, JobRecord, JobType } from '../../../shared/jobs'

export interface JobContext {
  /** Annulation (pause, fermeture de bibliothèque). */
  signal: AbortSignal
  now(): number
}

export type JobHandler = (job: JobRecord, ctx: JobContext) => Promise<JobOutcome>

export function notImplementedJob(type: JobType): JobHandler {
  return () => Promise.reject(new AppError('not_implemented', `job ${type} non implémenté`))
}
