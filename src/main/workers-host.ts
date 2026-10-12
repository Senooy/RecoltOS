/**
 * Worker host: launches a utilityProcess, RPC `WorkerRequest/Response`,
 * restart with backoff (1 s, 5 s, 30 s) after an unexpected exit, `stopAll()`
 * (SIGTERM then kill after 3 s). No worker opens the database.
 *
 * After a crash, pending requests are rejected (`worker_crashed`) and reported to
 * `onCrash` with their `jobId`: the job queue puts these jobs back to `queued`
 * (`UPDATE jobs SET state='queued' … WHERE id IN (…)`, without consuming an attempt).
 * Requests not yet sent wait for the restart.
 *
 * A worker that dies before sending `hello` (module not found, broken native `sharp`,
 * badly unpacked asar) will not restart any better: after `maxStartFailures` consecutive exits
 * without `hello`, the host switches to the `broken` state. All pending requests are then
 * rejected with `worker_unavailable` (and reported to `onCrash`, `broken: true`), and subsequent
 * calls are refused the same way, until an explicit `restart()`.
 *
 * The launch is injected (`fork`): `utilityFork` (Electron) in production,
 * `child_process.fork` in tests.
 */
import { AppError } from '../shared/errors'
import { getLang, onLangChange, type Lang } from '../shared/i18n/lang'
import { mt } from './i18n'
import type {
  MediaArgs,
  MediaOp,
  MediaResult,
  WorkerRequest,
  WorkerResponse,
} from '../shared/worker-protocol'
import { CONTROL_OPS, isHello } from './workers/control'
import type { MediaTools } from './workers/media/exec'

/** Child process as seen by the host (adapted from a `UtilityProcess` or a `ChildProcess`). */
export interface WorkerChild {
  readonly pid?: number | undefined
  postMessage(msg: WorkerRequest): void
  onMessage(cb: (msg: unknown) => void): void
  onExit(cb: (code: number | null, signal: string | null) => void): void
  kill(signal?: NodeJS.Signals): void
}

export type ForkFn = (modulePath: string, opts: { serviceName: string }) => WorkerChild

export interface CallOptions {
  /** Queue job to put back to `queued` if the worker dies during the call. */
  jobId?: number
  signal?: AbortSignal
  timeoutMs?: number
  onProgress?: (p: unknown) => void
}

export interface InterruptedCall {
  requestId: number
  op: string
  jobId?: number
}

export interface CrashInfo {
  name: string
  code: number | null
  signal: string | null
  /** Requests sent to the worker and lost with it. */
  interrupted: InterruptedCall[]
  /** Delay before restart (backoff); 0 if `broken`. */
  restartInMs: number
  /**
   * The worker does not start (repeated exits without `hello`): no more automatic restart,
   * the requests in `interrupted` are rejected with `worker_unavailable`. The job must not be
   * re-run in a loop: mark it as failed, then `restart()` once the cause is fixed.
   */
  broken: boolean
}

export interface HostLogger {
  info(...a: unknown[]): void
  warn(...a: unknown[]): void
  error(...a: unknown[]): void
}

export interface WorkerHostOptions {
  /** `serviceName` of the utilityProcess (e.g. `recolt-media`). */
  name: string
  modulePath: string
  fork: ForkFn
  /** Successive restart delays; the last one repeats. */
  backoffMs?: readonly number[]
  /** Consecutive exits without `hello` before the `broken` state (default 3). */
  maxStartFailures?: number
  /** Max delay to receive `hello` after launch (default 15 s). */
  startTimeoutMs?: number
  /** A worker that stays ready this long resets the backoff to zero. */
  stableAfterMs?: number
  /** SIGTERM, then SIGKILL after this delay. */
  stopTimeoutMs?: number
  /** Configuration sent back by `__configure` at each start. */
  config?: unknown
  onCrash?: (info: CrashInfo) => void
  onReady?: (pid: number) => void
  log?: HostLogger
}

export type HostState =
  'idle' | 'starting' | 'ready' | 'restarting' | 'broken' | 'stopping' | 'stopped'

interface Pending {
  id: number
  op: string
  args: unknown
  sent: boolean
  internal: boolean
  opts: CallOptions
  resolve(v: unknown): void
  reject(e: unknown): void
  cleanup(): void
}

export const DEFAULT_BACKOFF_MS = [1_000, 5_000, 30_000] as const
export const DEFAULT_MAX_START_FAILURES = 3
/** Max delay before `hello`: beyond it, the process is killed and counted as a failed start. */
export const DEFAULT_START_TIMEOUT_MS = 15_000

const silent: HostLogger = { info: () => {}, warn: () => {}, error: () => {} }

const hosts = new Set<WorkerHost>()

export class WorkerHost {
  readonly name: string
  private readonly opts: WorkerHostOptions
  private readonly log: HostLogger
  private child: WorkerChild | null = null
  private ready = false
  private _state: HostState = 'idle'
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private attempt = 0
  /** Consecutive exits without `hello`. */
  private startFailures = 0
  /** `hello` received from the current process. */
  private helloSeen = false
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private stopPromise: Promise<void> | null = null
  private startTimer: ReturnType<typeof setTimeout> | null = null
  private exitWaiters: (() => void)[] = []
  private config: unknown
  /** Number of restarts performed (diagnostics). */
  restarts = 0

  constructor(opts: WorkerHostOptions) {
    this.opts = opts
    this.name = opts.name
    this.log = opts.log ?? silent
    this.config = opts.config
    hosts.add(this)
  }

  get state(): HostState {
    return this._state
  }

  get pid(): number | undefined {
    return this.child?.pid
  }

  /** Starts the worker if needed (otherwise it starts on the first call). */
  start(): void {
    if (this._state === 'idle') this.spawn()
  }

  /**
   * Explicit restart after the `broken` state (cause fixed: build repaired, tools re-detected).
   * No effect in other states.
   */
  restart(): void {
    if (this._state !== 'broken') return
    this.attempt = 0
    this.startFailures = 0
    this.spawn()
  }

  /** Changes the configuration; sent right away if the worker is running, and at each restart. */
  setConfig(config: unknown): Promise<void> {
    this.config = config
    // Not ready yet: the `hello` message will trigger sending `this.config`.
    if (!this.ready) return Promise.resolve()
    return this.request(CONTROL_OPS.configure, config, {}, true).then(() => undefined)
  }

  call(op: string, args: unknown, opts: CallOptions = {}): Promise<unknown> {
    return this.request(op, args, opts, false)
  }

  private request(
    op: string,
    args: unknown,
    opts: CallOptions,
    internal: boolean,
  ): Promise<unknown> {
    if (this._state === 'stopping' || this._state === 'stopped') {
      return Promise.reject(new AppError('cancelled', `worker ${this.name} stopped`))
    }
    if (this._state === 'broken') {
      return Promise.reject(this.unavailable(op, opts.jobId))
    }
    if (opts.signal?.aborted)
      return Promise.reject(new AppError('cancelled', mt().errors.operationCancelled))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const onAbort = (): void =>
        this.abandon(id, new AppError('cancelled', mt().errors.operationCancelled))
      const p: Pending = {
        id,
        op,
        args,
        sent: false,
        internal,
        opts,
        resolve,
        reject,
        cleanup: () => {
          if (timer) clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
        },
      }
      this.pending.set(id, p)
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      if (opts.timeoutMs !== undefined) {
        timer = setTimeout(
          () => this.abandon(id, new AppError('timeout', mt().errors.operationTimeout(op))),
          opts.timeoutMs,
        )
      }
      if (this._state === 'idle') this.spawn()
      else if (this.ready) this.send(p)
    })
  }

  private unavailable(op: string, jobId: number | undefined): AppError {
    return new AppError('worker_unavailable', mt().errors.workerNotStarting(this.name, op), {
      jobId,
    })
  }

  /** Rejects a request and asks the worker to cancel it. */
  private abandon(id: number, err: AppError): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    p.cleanup()
    if (p.sent && this.child && this.ready) {
      try {
        this.child.postMessage({ id: 0, op: CONTROL_OPS.cancel, args: { id } })
      } catch {
        // worker dying: nothing to cancel
      }
    }
    p.reject(err)
  }

  private send(p: Pending): void {
    if (!this.child) return
    try {
      this.child.postMessage({ id: p.id, op: p.op, args: p.args })
      p.sent = true
    } catch (err) {
      this.log.warn(`[${this.name}] send failed`, err)
    }
  }

  private spawn(): void {
    this._state = this._state === 'idle' ? 'starting' : 'restarting'
    this.ready = false
    this.helloSeen = false
    let child: WorkerChild
    try {
      child = this.opts.fork(this.opts.modulePath, { serviceName: this.name })
    } catch (err) {
      this.log.error(`[${this.name}] launch failed`, err)
      this.handleExit(null, null, null)
      return
    }
    this.child = child
    this.clearStartTimer()
    const limit = this.opts.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
    this.startTimer = setTimeout(() => {
      this.startTimer = null
      if (this.child !== child || this.helloSeen) return
      this.log.error(`[${this.name}] no hello after ${limit} ms; process stopped`)
      try {
        child.kill('SIGKILL')
      } catch {
        // already dead
      }
    }, limit)
    child.onMessage((m) => {
      if (this.child === child) this.onMessage(m)
    })
    child.onExit((code, signal) => this.handleExit(child, code, signal))
  }

  private onMessage(m: unknown): void {
    if (isHello(m)) {
      if (this._state === 'stopping' || this._state === 'stopped') {
        // Stop requested during startup: in Electron, `kill()` before the spawn has no
        // effect. `hello` proves the process exists: we send SIGTERM without declaring it ready.
        try {
          this.child?.kill('SIGTERM')
        } catch {
          // already dead
        }
        return
      }
      this.clearStartTimer()
      this.ready = true
      this.helloSeen = true
      this.startFailures = 0
      this._state = 'ready'
      this.log.info(`[${this.name}] ready (pid ${m.pid})`)
      if (this.config !== undefined) {
        // The configuration goes before any pending request.
        this.child?.postMessage({ id: 0, op: CONTROL_OPS.configure, args: this.config })
      }
      for (const p of [...this.pending.values()].sort((a, b) => a.id - b.id)) {
        if (!p.sent) this.send(p)
      }
      if (this.stableTimer) clearTimeout(this.stableTimer)
      this.stableTimer = setTimeout(() => {
        this.attempt = 0
      }, this.opts.stableAfterMs ?? 60_000)
      this.stableTimer.unref?.()
      this.opts.onReady?.(m.pid)
      return
    }
    const r = m as WorkerResponse
    if (typeof r !== 'object' || r === null || typeof r.id !== 'number' || r.id === 0) return
    const p = this.pending.get(r.id)
    if (!p) return
    if ('progress' in r) {
      p.opts.onProgress?.(r.progress)
      return
    }
    this.pending.delete(r.id)
    p.cleanup()
    if (r.ok) p.resolve(r.result)
    else {
      const details = r.error.retryAt === undefined ? undefined : { retryAt: r.error.retryAt }
      p.reject(new AppError(r.error.code, r.error.message, details))
    }
  }

  private clearStartTimer(): void {
    if (this.startTimer) clearTimeout(this.startTimer)
    this.startTimer = null
  }

  private handleExit(child: WorkerChild | null, code: number | null, signal: string | null): void {
    if (child && this.child !== child) return
    this.clearStartTimer()
    this.child = null
    this.ready = false
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.stableTimer = null

    if (this._state === 'stopping' || this._state === 'stopped') {
      this.finishStop()
      return
    }

    // A child that never said `hello` ran nothing: its requests (`sent` or not) are
    // lost in advance, and too many exits of this kind mean that startup is broken.
    if (!this.helloSeen) this.startFailures++
    const broken = this.startFailures >= (this.opts.maxStartFailures ?? DEFAULT_MAX_START_FAILURES)

    const interrupted: InterruptedCall[] = []
    for (const p of [...this.pending.values()]) {
      if (!p.sent && !broken) continue
      this.pending.delete(p.id)
      p.cleanup()
      if (p.internal) {
        // `__configure` is sent back automatically on restart.
        p.resolve(null)
        continue
      }
      const it: InterruptedCall = { requestId: p.id, op: p.op }
      if (p.opts.jobId !== undefined) it.jobId = p.opts.jobId
      interrupted.push(it)
      p.reject(
        broken
          ? this.unavailable(p.op, p.opts.jobId)
          : new AppError('worker_crashed', mt().errors.workerCrashed(this.name, p.op), {
              jobId: p.opts.jobId,
            }),
      )
    }
    if (broken) {
      this._state = 'broken'
      this.log.error(
        `[${this.name}] startup failed (${this.startFailures} exits without hello, ` +
          `code ${code ?? '–'}, signal ${signal ?? '–'}); ${interrupted.length} request(s) rejected`,
      )
      try {
        this.opts.onCrash?.({ name: this.name, code, signal, interrupted, restartInMs: 0, broken })
      } catch (err) {
        this.log.error(`[${this.name}] onCrash threw an error`, err)
      }
      return
    }
    const delays = this.opts.backoffMs ?? DEFAULT_BACKOFF_MS
    const restartInMs = delays[Math.min(this.attempt, delays.length - 1)] ?? 30_000
    this.attempt++
    this._state = 'restarting'
    this.log.warn(
      `[${this.name}] unexpected exit (code ${code ?? '–'}, signal ${signal ?? '–'}); ` +
        `restarting in ${restartInMs} ms, ${interrupted.length} request(s) interrupted`,
    )
    try {
      this.opts.onCrash?.({
        name: this.name,
        code,
        signal,
        interrupted,
        restartInMs,
        broken,
      })
    } catch (err) {
      this.log.error(`[${this.name}] onCrash threw an error`, err)
    }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this._state !== 'restarting') return
      this.restarts++
      this.spawn()
    }, restartInMs)
  }

  /** Completes a requested stop (worker exit or safety net). Idempotent. */
  private finishStop(): void {
    this.child = null
    this.ready = false
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.stableTimer = null
    this._state = 'stopped'
    for (const p of this.pending.values()) {
      p.cleanup()
      p.reject(new AppError('cancelled', `worker ${this.name} stopped`))
    }
    this.pending.clear()
    const waiters = this.exitWaiters
    this.exitWaiters = []
    for (const w of waiters) w()
  }

  /** Clean stop: SIGTERM, then SIGKILL after `stopTimeoutMs` (3 s). Idempotent. */
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopPromise = new Promise<void>((resolve) => {
      this.clearStartTimer()
      if (this.restartTimer) clearTimeout(this.restartTimer)
      this.restartTimer = null
      if (this.stableTimer) clearTimeout(this.stableTimer)
      const child = this.child
      this._state = 'stopping'
      if (!child) {
        this.finishStop()
        resolve()
        return
      }
      const grace = this.opts.stopTimeoutMs ?? 3_000
      let forceTimer: ReturnType<typeof setTimeout> | null = null
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already dead
        }
        // Safety net: without an `exit` event, the stop must never block shutdown.
        // Direct call (not `handleExit`): `this.child` may already have changed.
        forceTimer = setTimeout(() => this.finishStop(), grace)
      }, grace)
      this.exitWaiters.push(() => {
        clearTimeout(killTimer)
        if (forceTimer) clearTimeout(forceTimer)
        resolve()
      })
      try {
        child.kill('SIGTERM')
      } catch {
        // already dead
      }
    }).finally(() => hosts.delete(this))
    return this.stopPromise
  }
}

/** Stops all workers (app shutdown). */
export async function stopAll(): Promise<void> {
  await Promise.all([...hosts].map((h) => h.stop()))
}

/** Typed client of the media-worker. */
export interface MediaWorker {
  readonly host: WorkerHost
  call<O extends MediaOp>(op: O, args: MediaArgs<O>, opts?: CallOptions): Promise<MediaResult<O>>
  /** Restart after the `broken` state (see `WorkerHost.restart`). */
  restart(): void
  /** Tool paths (after "Re-detect"); sent back at each restart. */
  setTools(tools: MediaTools): Promise<void>
  stop(): Promise<void>
}

export const MEDIA_SERVICE_NAME = 'recolt-media'

export function createMediaWorker(
  opts: Omit<WorkerHostOptions, 'name' | 'config'> & { tools: MediaTools },
): MediaWorker {
  const { tools, ...rest } = opts
  // The language follows the app: the worker's error messages (tool not found...) are translated.
  let config: { tools: MediaTools; lang: Lang } = { tools, lang: getLang() }
  const host = new WorkerHost({ ...rest, name: MEDIA_SERVICE_NAME, config })
  const offLang = onLangChange((lang) => {
    config = { ...config, lang }
    host.setConfig(config).catch(() => undefined)
  })
  return {
    host,
    call: (op, args, o) => host.call(op, args, o) as Promise<never>,
    restart: () => host.restart(),
    setTools: (t) => {
      config = { ...config, tools: t }
      return host.setConfig(config)
    },
    stop: () => {
      offLang()
      return host.stop()
    },
  }
}
