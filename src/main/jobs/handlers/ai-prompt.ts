/**
 * Handler for the `ai.prompt` job: on-demand image prompt, via the AI service.
 */
import { AppError } from '../../../shared/errors'
import { getAiService } from '../../ai/service'
import type { JobHandler } from './types'

export const aiPrompt: JobHandler = (job, ctx) => {
  const s = getAiService()
  if (!s) return Promise.reject(new AppError('not_implemented', 'service IA indisponible'))
  return s.handleJob(job, ctx)
}
