/**
 * Contract for a job handler (single `jobs` queue).
 * The context carries the services (active library, media-worker, network, preferences,
 * batched `items.changed` emission) so that handlers stay testable under Node.
 */
import { AppError } from '../../../shared/errors'
import type { JobOutcome, JobRecord, JobType } from '../../../shared/jobs'
import type { Prefs } from '../../../shared/prefs'
import type { MediaArgs, MediaOp, MediaResult } from '../../../shared/worker-protocol'
import type { LibraryContext } from '../../library/library-context'
import type { TrashItemFn } from '../../platform/trash'

export type ChangeReason = 'created' | 'updated' | 'derived' | 'trashed' | 'restored' | 'purged'

/** Typed call to the media-worker (`MediaWorker.call` in the app, `runMediaOp` in tests). */
export type MediaCaller = <O extends MediaOp>(
  op: O,
  args: MediaArgs<O>,
  opts?: { jobId?: number; signal?: AbortSignal; timeoutMs?: number },
) => Promise<MediaResult<O>>

/** `net.fetch` in the app, global `fetch` in tests. */
export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal; method?: string },
) => Promise<Response>

export interface JobLogger {
  info(...a: unknown[]): void
  warn(...a: unknown[]): void
  error(...a: unknown[]): void
}

/** Services shared by the queue, the handlers and ingestion. */
export interface JobServices {
  lib: LibraryContext
  media: MediaCaller
  fetch: FetchFn
  prefs(): Prefs
  /** Batched `items.changed` (one emission per reason every ~300 ms). */
  changed(uuids: readonly string[], reason: ChangeReason): void
  /** Video tools available (otherwise degraded mode). */
  hasTool(name: 'ffmpeg' | 'ffprobe'): boolean
  /** Immediately restarts the queue (after an `enqueue`). */
  kick(): void
  trashItem?: TrashItemFn
  log: JobLogger
}

export interface JobContext extends JobServices {
  /** Cancellation (pause, library closing). */
  signal: AbortSignal
  now(): number
  /** Last attempt: a failure will be final. */
  lastAttempt: boolean
}

export type JobHandler = (job: JobRecord, ctx: JobContext) => Promise<JobOutcome>

/** Side effect after a final failure (media `failed` / `missing`, avatar `failed`…). */
export type JobFailureHook = (
  job: JobRecord,
  error: { code: string; message: string },
  services: JobServices,
) => void

export function notImplementedJob(type: JobType): JobHandler {
  return () => Promise.reject(new AppError('not_implemented', `job ${type} non implémenté`))
}

/** Numeric identifier of a payload (`mediaId`, `authorId`…) or `null`. */
export function payloadId(job: JobRecord, key: string): number | null {
  const v = job.payload[key]
  return typeof v === 'number' && Number.isInteger(v) ? v : null
}

export function payloadString(job: JobRecord, key: string): string | null {
  const v = job.payload[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}
