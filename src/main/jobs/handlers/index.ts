/**
 * Table FIGÉE type de job → handler (PLAN §1.26, §4.2). Chaque lot remplit son fichier.
 */
import type { JobType } from '../../../shared/jobs'
import { aiEnrich } from './ai-enrich'
import { aiPrompt } from './ai-prompt'
import { avatarFetch } from './avatar-fetch'
import { mediaDerive } from './media-derive'
import { mediaDownload } from './media-download'
import { mediaPreview } from './media-preview'
import { purgeFiles } from './purge-files'
import { remoteFetch } from './remote-fetch'
import type { JobHandler } from './types'

export type { JobContext, JobHandler } from './types'

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
