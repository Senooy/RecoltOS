/** Contrat `jobs.*`. */
import { z } from 'zod'
import { JobType, JobsStatus } from '../jobs'
import { Count, Empty, Void, type ContractShape, type EventShape } from './define'

const TypeOpt = z.object({ type: JobType.optional() }).default({})

export const jobsContract = {
  'jobs.status': { input: Empty, output: JobsStatus },
  'jobs.retryFailed': { input: TypeOpt, output: Count },
  'jobs.pause': { input: TypeOpt, output: Void },
  'jobs.resume': { input: TypeOpt, output: Void },
} as const satisfies ContractShape

export const jobsEvents = {
  'jobs.progress': JobsStatus,
} as const satisfies EventShape
