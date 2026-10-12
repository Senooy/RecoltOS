/**
 * Shared access to the queue and job services (IPC handlers `ingest.*`, `jobs.*`, import).
 * Filled in by `jobs/init.ts`; empty outside Electron (registry tests).
 */
import { AppError } from '../../shared/errors'
import type { PageCapture } from '../ingest/ingest'
import type { ChangeReason, JobServices } from './handlers/types'
import type { JobQueue } from './queue'
import { mt } from '../i18n'

let queue: JobQueue | null = null
let servicesFn: (() => JobServices | null) | null = null
let captureFn: ((url: string) => Promise<PageCapture>) | null = null

export function setJobRuntime(
  q: JobQueue | null,
  services: (() => JobServices | null) | null,
  capture: typeof captureFn = null,
): void {
  queue = q
  servicesFn = services
  captureFn = capture
}

let ingestProgress: ((p: { done: number; total: number; current: string | null }) => void) | null =
  null

/** `ingest.progress` (plugged in by `jobs/init.ts`). */
export function setIngestProgressEmitter(fn: typeof ingestProgress): void {
  ingestProgress = fn
}

export function emitIngestProgress(p: {
  done: number
  total: number
  current: string | null
}): void {
  ingestProgress?.(p)
}

export function getJobQueue(): JobQueue | null {
  return queue
}

export function requireJobServices(): JobServices {
  const s = servicesFn?.() ?? null
  if (!s) throw new AppError('library_unavailable', mt().errors.noLibrary)
  return s
}

export function getPageCapture() {
  return captureFn
}

type Emit = (payload: { uuids: string[]; reason: ChangeReason }) => void

/**
 * `items.changed` grouped by reason: at most one emission every `delayMs` (an import or
 * 700 derived items do not flood the renderer).
 */
export function createChangeBatcher(emit: Emit, delayMs = 300) {
  const pending = new Map<ChangeReason, Set<string>>()
  let timer: NodeJS.Timeout | null = null
  const flush = () => {
    timer = null
    for (const [reason, set] of pending) {
      if (set.size > 0) emit({ uuids: [...set], reason })
    }
    pending.clear()
  }
  return {
    push(uuids: readonly string[], reason: ChangeReason) {
      if (uuids.length === 0) return
      let set = pending.get(reason)
      if (!set) pending.set(reason, (set = new Set()))
      for (const u of uuids) set.add(u)
      if (!timer) {
        timer = setTimeout(flush, delayMs)
        timer.unref?.()
      }
    },
    flush() {
      if (timer) clearTimeout(timer)
      flush()
    },
  }
}
