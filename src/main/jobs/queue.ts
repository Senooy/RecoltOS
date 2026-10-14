/**
 * Persistent job queue: one loop per type, each with its own
 * cap; a saturated or paused type never blocks the others. Retry at
 * `2^attempts × 30 s`; 4xx and permanent errors are not retried; `provider_rate_limited` puts
 * the job back in the queue without consuming an attempt and pauses the type; per-type pauses persisted
 * in `settings['jobs.paused']`. No dependency on Electron.
 */
import {
  JOB_TYPES,
  type JobOutcome,
  type JobRecord,
  type JobType,
  type JobsStatus,
} from '../../shared/jobs'
import { setJobsAddedListener } from '../db/repos/jobs'
import type { JobFailureHook, JobHandler, JobServices } from './handlers/types'

export const JOB_CONCURRENCY: Readonly<Record<JobType, number>> = {
  'media.derive': 4,
  'media.preview': 2,
  'media.download': 4,
  'remote.fetch': 4,
  'avatar.fetch': 4,
  'ai.enrich': 1,
  'ai.prompt': 1,
  'purge.files': 1,
}

export const BACKOFF_BASE_MS = 30_000
export const RATE_LIMIT_DEFAULT_MS = 3_600_000
export const PAUSED_SETTING = 'jobs.paused'

/** Permanent error codes: no retry. */
export const FATAL_CODES: ReadonlySet<string> = new Set([
  'not_found',
  'validation',
  'unsupported',
  'decode_failed',
  'system.decode_failed',
  'not_implemented',
  'unknown_op',
  'worker_unavailable',
  'system.worker_unavailable',
  'tool_missing',
  'http_4xx',
  'disabled',
])

/** Codes that put the job back in the queue without consuming an attempt. */
const REFUND_CODES: ReadonlySet<string> = new Set(['cancelled', 'worker_crashed'])

export interface PauseEntry {
  until: number | null
  reason: string
}

export interface JobQueueDeps {
  /** Services of the active library, or `null` (no library). */
  services(): JobServices | null
  handlers: Readonly<Record<JobType, JobHandler>>
  failureHooks?: Partial<Record<JobType, JobFailureHook>>
  now?: () => number
  concurrency?: Partial<Record<JobType, number>>
  /** Dynamic cap (e.g. `prefs.ai.concurrency`); takes precedence over `concurrency`. */
  concurrencyOf?: (type: JobType) => number | undefined
  /**
   * Safety wake-up period. The queue is event-driven: it wakes up on `enqueue`, at the end of a job,
   * at the next deferred `run_after` and at the end of a pause; no polling while idle.
   */
  tickMs?: number
  /** Called (at most every `statusThrottleMs`) when the queue state changes. */
  onStatus?: (s: JobsStatus) => void
  statusThrottleMs?: number
}

interface Running {
  job: JobRecord
  abort: AbortController
  done: Promise<void>
}

function errorOf(err: unknown): { code: string; message: string; retryAt?: number } {
  if (typeof err === 'object' && err !== null) {
    const e = err as { code?: unknown; message?: unknown; details?: unknown; retryAt?: unknown }
    const code = typeof e.code === 'string' ? e.code : 'internal'
    const message = typeof e.message === 'string' ? e.message : 'unknown error'
    const details = e.details as { retryAt?: unknown } | undefined
    const retryAt =
      typeof e.retryAt === 'number'
        ? e.retryAt
        : typeof details?.retryAt === 'number'
          ? details.retryAt
          : undefined
    return retryAt === undefined ? { code, message } : { code, message, retryAt }
  }
  return { code: 'internal', message: typeof err === 'string' ? err : 'unknown error' }
}

export class JobQueue {
  private readonly deps: JobQueueDeps
  private readonly now: () => number
  private readonly running = new Map<number, Running>()
  private paused = false
  private started = false
  private timer: NodeJS.Timeout | null = null
  private wakeTimer: NodeJS.Timeout | null = null
  private wakeAt = 0
  private kickQueued = false
  private pumping = false
  private pumpAgain = false
  private pauses: Record<string, PauseEntry> = {}
  private statusTimer: NodeJS.Timeout | null = null
  private idleWaiters: (() => void)[] = []

  constructor(deps: JobQueueDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
  }

  private cap(type: JobType): number {
    return this.deps.concurrencyOf?.(type) ?? this.deps.concurrency?.[type] ?? JOB_CONCURRENCY[type]
  }

  /** Starts the loop (idempotent). On first start: re-reads the persisted pauses. */
  start(): void {
    if (!this.started) {
      this.started = true
      this.loadPauses()
      // New jobs (any `enqueue`, wherever it comes from): one coalesced kick per tick.
      setJobsAddedListener(() => this.kickSoon())
      if (this.deps.tickMs) {
        this.timer = setInterval(() => this.kick(), this.deps.tickMs)
        this.timer.unref?.()
      }
    }
    this.paused = false
    this.kick()
  }

  /** Full stop: cancels running jobs (put back in the queue) and waits for them to end. */
  async stop(): Promise<void> {
    this.paused = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.clearWake()
    setJobsAddedListener(null)
    this.started = false
    for (const r of this.running.values()) r.abort.abort()
    await Promise.allSettled([...this.running.values()].map((r) => r.done))
    if (this.statusTimer) clearTimeout(this.statusTimer)
    this.statusTimer = null
  }

  /**
   * No more job pickup; waits for running jobs to finish for at most `ms`, then
   * cancels them (they go back to `queued` without consuming an attempt). For `closeLibrary`.
   */
  async pause(ms = 5_000): Promise<void> {
    this.paused = true
    const all = Promise.allSettled([...this.running.values()].map((r) => r.done))
    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))
    if ((await Promise.race([all, timeout])) === 'timeout') {
      for (const r of this.running.values()) r.abort.abort()
      await Promise.allSettled([...this.running.values()].map((r) => r.done))
    }
  }

  resume(): void {
    if (!this.started) {
      this.start()
      return
    }
    this.paused = false
    this.loadPauses()
    this.kick()
  }

  isPaused(): boolean {
    return this.paused
  }

  /** Pauses a type (or all); `until = null` = until manually resumed. */
  pauseType(type: JobType | null, until: number | null, reason: string): void {
    const types = type ? [type] : [...JOB_TYPES]
    for (const t of types) this.pauses[t] = { until, reason }
    this.savePauses()
    this.scheduleStatus()
  }

  resumeType(type: JobType | null): void {
    const types = type ? [type] : [...JOB_TYPES]
    for (const t of types) delete this.pauses[t]
    this.savePauses()
    this.kick()
  }

  pausedUntil(type: JobType): number | null | undefined {
    const p = this.pauses[type]
    if (!p) return undefined
    if (p.until !== null && p.until <= this.now()) {
      delete this.pauses[type]
      this.savePauses()
      return undefined
    }
    return p.until
  }

  private loadPauses(): void {
    const s = this.deps.services()
    const raw = s?.lib.repos.settings.get(PAUSED_SETTING)
    this.pauses = raw && typeof raw === 'object' ? { ...(raw as Record<string, PauseEntry>) } : {}
  }

  private savePauses(): void {
    const s = this.deps.services()
    if (!s) return
    if (Object.keys(this.pauses).length === 0) s.lib.repos.settings.delete(PAUSED_SETTING)
    else s.lib.repos.settings.set(PAUSED_SETTING, this.pauses)
  }

  /** `kick` at the next microtask, coalesced (a batch of `enqueue` = one selection). */
  private kickSoon(): void {
    if (this.kickQueued) return
    this.kickQueued = true
    queueMicrotask(() => {
      this.kickQueued = false
      this.kick()
    })
  }

  /** Re-runs the selection (after an `enqueue`, the end of a job or a scheduled wake-up). */
  kick(): void {
    if (this.pumping) {
      this.pumpAgain = true
      return
    }
    this.pumping = true
    try {
      do {
        this.pumpAgain = false
        this.pump()
      } while (this.pumpAgain)
    } finally {
      this.pumping = false
    }
    this.scheduleWake()
    this.checkIdle()
  }

  private clearWake(): void {
    if (this.wakeTimer) clearTimeout(this.wakeTimer)
    this.wakeTimer = null
    this.wakeAt = 0
  }

  /**
   * Single timer on the next event that can make a job ready: earliest deferred `run_after`, or
   * end of a type's pause. Nothing scheduled when nothing is waiting (0 wake-ups at rest).
   */
  private scheduleWake(): void {
    if (this.paused || !this.started) {
      this.clearWake()
      return
    }
    const services = this.deps.services()
    if (!services) {
      this.clearWake()
      return
    }
    const now = this.now()
    let next: number | null = null
    try {
      next = services.lib.repos.jobs.nextRunAfter(now)
    } catch {
      next = null
    }
    for (const p of Object.values(this.pauses)) {
      if (p.until !== null && p.until > now && (next === null || p.until < next)) next = p.until
    }
    if (next === null) {
      this.clearWake()
      return
    }
    if (this.wakeTimer && this.wakeAt === next) return
    this.clearWake()
    this.wakeAt = next
    // Capped: a `setTimeout` beyond 2^31 ms fires immediately.
    const delay = Math.min(Math.max(0, next - now) + 5, 2 ** 31 - 1)
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null
      this.wakeAt = 0
      this.kick()
    }, delay)
    this.wakeTimer.unref?.()
  }

  private runningOf(type: JobType): number {
    let n = 0
    for (const r of this.running.values()) if (r.job.type === type) n++
    return n
  }

  private pump(): void {
    if (this.paused || !this.started) return
    const services = this.deps.services()
    if (!services) return
    for (const type of JOB_TYPES) {
      if (this.pausedUntil(type) !== undefined) continue
      while (this.runningOf(type) < this.cap(type)) {
        let job: JobRecord | null
        try {
          job = services.lib.repos.jobs.claimNext(type, this.now())
        } catch (err) {
          services.log.error('[jobs] selection failed', err)
          return
        }
        if (!job) break
        this.launch(job, services)
      }
    }
  }

  private launch(job: JobRecord, services: JobServices): void {
    const abort = new AbortController()
    const handler = this.deps.handlers[job.type]
    const ctx = {
      ...services,
      signal: abort.signal,
      now: this.now,
      lastAttempt: job.attempts >= job.maxAttempts,
    }
    const done = (async () => {
      let outcome: JobOutcome
      try {
        outcome = await handler(job, ctx)
      } catch (err) {
        this.applyError(job, err, services, abort.signal.aborted)
        return
      }
      this.applyOutcome(job, outcome, services)
    })()
      .catch((err: unknown) => services.log.error(`[jobs] ${job.type}#${job.id}`, err))
      .finally(() => {
        this.running.delete(job.id)
        this.scheduleStatus()
        queueMicrotask(() => this.kick())
      })
    this.running.set(job.id, { job, abort, done })
    this.scheduleStatus()
  }

  private applyOutcome(job: JobRecord, outcome: JobOutcome, services: JobServices): void {
    const jobs = services.lib.repos.jobs
    if (outcome.status === 'done') {
      jobs.complete(job.id, this.now())
    } else if (outcome.status === 'defer') {
      jobs.retry(job.id, outcome.retryAt, outcome.error ?? null, {
        refundAttempt: true,
        at: this.now(),
      })
    } else if (outcome.status === 'retry' && job.attempts < job.maxAttempts) {
      jobs.retry(job.id, outcome.retryAt, outcome.error, { at: this.now() })
    } else {
      this.failFinal(job, outcome.status === 'failed' ? outcome.error : outcome.error, services)
    }
  }

  private failFinal(
    job: JobRecord,
    error: { code: string; message: string },
    services: JobServices,
  ): void {
    services.lib.repos.jobs.fail(job.id, error, this.now())
    try {
      this.deps.failureHooks?.[job.type]?.(job, error, services)
    } catch (err) {
      services.log.error(`[jobs] hook failure ${job.type}`, err)
    }
  }

  private applyError(job: JobRecord, err: unknown, services: JobServices, aborted: boolean): void {
    const e = errorOf(err)
    const jobs = services.lib.repos.jobs
    const now = this.now()
    if (e.code === 'provider_rate_limited') {
      const until = e.retryAt ?? now + RATE_LIMIT_DEFAULT_MS
      jobs.retry(
        job.id,
        until,
        { code: e.code, message: e.message },
        { refundAttempt: true, at: now },
      )
      this.pauseType(job.type, until, 'provider_rate_limited')
      return
    }
    if (aborted || REFUND_CODES.has(e.code)) {
      jobs.retry(
        job.id,
        now,
        { code: e.code, message: e.message },
        { refundAttempt: true, at: now },
      )
      return
    }
    if (FATAL_CODES.has(e.code) || job.attempts >= job.maxAttempts) {
      this.failFinal(job, { code: e.code, message: e.message }, services)
      return
    }
    const delay = 2 ** job.attempts * BACKOFF_BASE_MS
    jobs.retry(job.id, now + delay, { code: e.code, message: e.message }, { at: now })
  }

  /** State per type (`jobs.status`, `jobs.progress`). */
  status(): JobsStatus {
    const services = this.deps.services()
    const counts = services?.lib.repos.jobs.countsByType() ?? {}
    const byType: JobsStatus['byType'] = {}
    for (const type of JOB_TYPES) {
      const c = counts[type] ?? { queued: 0, running: 0, failed: 0 }
      const until = this.pausedUntil(type)
      byType[type] = {
        queued: c.queued,
        running: c.running,
        failed: c.failed,
        pausedUntil: until === undefined ? null : (until ?? Number.MAX_SAFE_INTEGER),
      }
    }
    return { byType }
  }

  private scheduleStatus(): void {
    if (!this.deps.onStatus || this.statusTimer) return
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null
      try {
        this.deps.onStatus?.(this.status())
      } catch {
        // library closed in the meantime
      }
    }, this.deps.statusThrottleMs ?? 500)
    this.statusTimer.unref?.()
  }

  /** Number of running jobs (all types). */
  runningCount(): number {
    return this.running.size
  }

  private checkIdle(): void {
    if (this.running.size > 0 || this.idleWaiters.length === 0) return
    const s = this.deps.services()
    const active = JOB_TYPES.filter((t) => this.pausedUntil(t) === undefined)
    const ready = s
      ? (
          s.lib.db
            .prepare(
              `SELECT count(*) AS n FROM jobs WHERE state = 'queued' AND run_after <= ?
               AND type IN (SELECT value FROM json_each(?))`,
            )
            .get(this.now(), JSON.stringify(active)) as { n: number }
        ).n
      : 0
    if (ready > 0 && !this.paused) return
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const w of waiters) w()
  }

  /** Tests and tools: resolves when no job is ready or running anymore. */
  whenIdle(): Promise<void> {
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve)
      queueMicrotask(() => this.kick())
    })
  }
}
