/**
 * Contrat d'un handler de job (file unique `jobs`).
 * le contexte porte les services (bibliothèque active, media-worker, réseau, préférences,
 * émission groupée de `items.changed`) pour que les handlers restent testables sous Node.
 */
import { AppError } from '../../../shared/errors'
import type { JobOutcome, JobRecord, JobType } from '../../../shared/jobs'
import type { Prefs } from '../../../shared/prefs'
import type { MediaArgs, MediaOp, MediaResult } from '../../../shared/worker-protocol'
import type { LibraryContext } from '../../library/library-context'
import type { TrashItemFn } from '../../platform/trash'

export type ChangeReason = 'created' | 'updated' | 'derived' | 'trashed' | 'restored' | 'purged'

/** Appel typé du media-worker (`MediaWorker.call` dans l'app, `runMediaOp` dans les tests). */
export type MediaCaller = <O extends MediaOp>(
  op: O,
  args: MediaArgs<O>,
  opts?: { jobId?: number; signal?: AbortSignal; timeoutMs?: number },
) => Promise<MediaResult<O>>

/** `net.fetch` dans l'app, `fetch` global dans les tests. */
export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal; method?: string },
) => Promise<Response>

export interface JobLogger {
  info(...a: unknown[]): void
  warn(...a: unknown[]): void
  error(...a: unknown[]): void
}

/** Services partagés par la file, les handlers et l'ingestion. */
export interface JobServices {
  lib: LibraryContext
  media: MediaCaller
  fetch: FetchFn
  prefs(): Prefs
  /** `items.changed` regroupé (une émission par raison toutes les ~300 ms). */
  changed(uuids: readonly string[], reason: ChangeReason): void
  /** Outils vidéo disponibles (sinon mode dégradé). */
  hasTool(name: 'ffmpeg' | 'ffprobe'): boolean
  /** Relance immédiate de la file (après un `enqueue`). */
  kick(): void
  trashItem?: TrashItemFn
  log: JobLogger
}

export interface JobContext extends JobServices {
  /** Annulation (pause, fermeture de bibliothèque). */
  signal: AbortSignal
  now(): number
  /** Dernière tentative : un échec sera définitif. */
  lastAttempt: boolean
}

export type JobHandler = (job: JobRecord, ctx: JobContext) => Promise<JobOutcome>

/** Effet de bord après un échec définitif (média `failed` / `missing`, avatar `failed`…). */
export type JobFailureHook = (
  job: JobRecord,
  error: { code: string; message: string },
  services: JobServices,
) => void

export function notImplementedJob(type: JobType): JobHandler {
  return () => Promise.reject(new AppError('not_implemented', `job ${type} non implémenté`))
}

/** Identifiant numérique d'une charge utile (`mediaId`, `authorId`…) ou `null`. */
export function payloadId(job: JobRecord, key: string): number | null {
  const v = job.payload[key]
  return typeof v === 'number' && Number.isInteger(v) ? v : null
}

export function payloadString(job: JobRecord, key: string): string | null {
  const v = job.payload[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}
