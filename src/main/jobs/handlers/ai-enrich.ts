/**
 * Handler du job `ai.enrich` (WP-43) : délègue au service IA (`ai/service.ts`), qui revérifie
 * consentement, fournisseur et exclusions avant tout appel.
 */
import { AppError } from '../../../shared/errors'
import { getAiService } from '../../ai/service'
import type { JobFailureHook, JobHandler } from './types'

export const aiEnrich: JobHandler = (job, ctx) => {
  const s = getAiService()
  if (!s) return Promise.reject(new AppError('not_implemented', 'service IA indisponible'))
  return s.handleJob(job, ctx)
}

/** Tentatives épuisées : l'élément passe en `ai_state = 'failed'`. */
export const aiEnrichFailed: JobFailureHook = (job, _error, services) => {
  const s = getAiService()
  if (s) s.onJobFailed(job, services)
  else if (job.itemId !== null) services.lib.repos.items.update(job.itemId, { aiState: 'failed' })
}
