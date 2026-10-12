/**
 * FROZEN table job type → handler. Each job type has its own file.
 */
import type { JobType } from '../../../shared/jobs'
import { aiEnrich, aiEnrichFailed } from './ai-enrich'
import { aiPrompt } from './ai-prompt'
import { avatarFetch, avatarFetchFailed } from './avatar-fetch'
import { mediaDerive, mediaDeriveFailed } from './media-derive'
import { mediaDownload, mediaDownloadFailed } from './media-download'
import { mediaPreview } from './media-preview'
import { purgeFiles } from './purge-files'
import { remoteFetch } from './remote-fetch'
import type { JobFailureHook, JobHandler } from './types'

export type { JobContext, JobFailureHook, JobHandler, JobServices } from './types'

export const jobHandlers: Readonly<Record<JobType, JobHandler>> = {
  'media.derive': mediaDerive,
  'media.preview': mediaPreview,
  'media.download': mediaDownload,
  'remote.fetch': remoteFetch,
  'avatar.fetch': avatarFetch,
  'ai.enrich': aiEnrich,
  'ai.prompt': aiPrompt,
  'purge.files': purgeFiles,
}

/** Side effects of a permanent failure (status of the media and of the avatar). */
export const jobFailureHooks: Partial<Record<JobType, JobFailureHook>> = {
  'media.derive': mediaDeriveFailed,
  'media.preview': () => undefined,
  'media.download': mediaDownloadFailed,
  'avatar.fetch': avatarFetchFailed,
  'ai.enrich': aiEnrichFailed,
}
