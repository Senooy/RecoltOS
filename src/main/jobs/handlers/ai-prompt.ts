/**
 * Handler du job `ai.prompt` : prompt d'image à la demande, via le service IA.
 */
import { AppError } from '../../../shared/errors'
import { getAiService } from '../../ai/service'
import type { JobHandler } from './types'

export const aiPrompt: JobHandler = (job, ctx) => {
  const s = getAiService()
  if (!s) return Promise.reject(new AppError('not_implemented', 'service IA indisponible'))
  return s.handleJob(job, ctx)
}
