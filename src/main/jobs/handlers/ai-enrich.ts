/**
 * Handler for the `ai.enrich` job: delegates to the AI service (`ai/service.ts`), which re-checks
 * consent, provider and exclusions before any call.
 */
import { AppError } from '../../../shared/errors'
import { getAiService } from '../../ai/service'
import type { JobFailureHook, JobHandler } from './types'

export const aiEnrich: JobHandler = (job, ctx) => {
  const s = getAiService()
  if (!s) return Promise.reject(new AppError('not_implemented', 'service IA indisponible'))
  return s.handleJob(job, ctx)
}

/** Attempts exhausted: the item moves to `ai_state = 'failed'`. */
export const aiEnrichFailed: JobFailureHook = (job, _error, services) => {
  const s = getAiService()
  if (s) s.onJobFailed(job, services)
  else if (job.itemId !== null) services.lib.repos.items.update(job.itemId, { aiState: 'failed' })
}
