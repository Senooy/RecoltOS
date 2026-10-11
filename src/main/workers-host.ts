/**
 * Hôte des workers (ARCHI §2.2) : lance un utilityProcess, RPC `WorkerRequest/Response`,
 * redémarrage avec backoff (1 s, 5 s, 30 s) après une sortie inattendue, `stopAll()`
 * (SIGTERM puis kill après 3 s). Aucun worker n'ouvre la base.
 *
 * Après un crash, les requêtes en cours sont rejetées (`worker_crashed`) et signalées à
 * `onCrash` avec leur `jobId` : la file de jobs (WP-10) remet ces jobs en `queued`
 * (`UPDATE jobs SET state='queued' … WHERE id IN (…)`, sans consommer de tentative).
 * Les requêtes pas encore envoyées attendent le redémarrage.
 *
 * Le lancement est injecté (`fork`) : `utilityFork` (Electron) en production,
 * `child_process.fork` dans les tests.
 */
import { AppError } from '../shared/errors'
import type {
  MediaArgs,
  MediaOp,
  MediaResult,
  WorkerRequest,
  WorkerResponse,
} from '../shared/worker-protocol'
import { CONTROL_OPS, isHello } from './workers/control'
import type { MediaTools } from './workers/media/exec'

/** Processus enfant vu par l'hôte (adapté d'un `UtilityProcess` ou d'un `ChildProcess`). */
export interface WorkerChild {
  readonly pid?: number | undefined
  postMessage(msg: WorkerRequest): void
  onMessage(cb: (msg: unknown) => void): void
  onExit(cb: (code: number | null, signal: string | null) => void): void
  kill(signal?: NodeJS.Signals): void
}

export type ForkFn = (modulePath: string, opts: { serviceName: string }) => WorkerChild

export interface CallOptions {
  /** Job de la file à remettre en `queued` si le worker meurt pendant l'appel. */
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
  /** Requêtes envoyées au worker et perdues avec lui. */
  interrupted: InterruptedCall[]
  /** Délai avant redémarrage (backoff). */
  restartInMs: number
}

export interface HostLogger {
  info(...a: unknown[]): void
  warn(...a: unknown[]): void
  error(...a: unknown[]): void
}

export interface WorkerHostOptions {
  /** `serviceName` de l'utilityProcess (ex. `recolt-media`). */
  name: string
  modulePath: string
  fork: ForkFn
  /** Délais de redémarrage successifs ; le dernier se répète. */
  backoffMs?: readonly number[]
  /** Un worker resté prêt aussi longtemps remet le backoff à zéro. */
  stableAfterMs?: number
  /** SIGTERM, puis SIGKILL après ce délai. */
  stopTimeoutMs?: number
  /** Configuration renvoyée par `__configure` à chaque démarrage. */
  config?: unknown
  onCrash?: (info: CrashInfo) => void
  onReady?: (pid: number) => void
  log?: HostLogger
}

export type HostState = 'idle' | 'starting' | 'ready' | 'restarting' | 'stopping' | 'stopped'

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
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private stopPromise: Promise<void> | null = null
  private exitWaiters: (() => void)[] = []
  private config: unknown
  /** Nombre de redémarrages effectués (diagnostic). */
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

  /** Démarre le worker si besoin (sinon, il démarre au premier appel). */
  start(): void {
    if (this._state === 'idle') this.spawn()
  }

  /** Change la configuration ; envoyée tout de suite si le worker tourne, et à chaque redémarrage. */
  setConfig(config: unknown): Promise<void> {
    this.config = config
    // Pas encore prêt : le message `hello` déclenchera l'envoi de `this.config`.
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
      return Promise.reject(new AppError('cancelled', `worker ${this.name} arrêté`))
    }
    if (opts.signal?.aborted) return Promise.reject(new AppError('cancelled', 'opération annulée'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const onAbort = (): void => this.abandon(id, new AppError('cancelled', 'opération annulée'))
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
          () => this.abandon(id, new AppError('timeout', `${op} : délai dépassé`)),
          opts.timeoutMs,
        )
      }
      if (this._state === 'idle') this.spawn()
      else if (this.ready) this.send(p)
    })
  }

  /** Rejette une requête et demande au worker de l'annuler. */
  private abandon(id: number, err: AppError): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    p.cleanup()
    if (p.sent && this.child && this.ready) {
      try {
        this.child.postMessage({ id: 0, op: CONTROL_OPS.cancel, args: { id } })
      } catch {
        // worker en train de mourir : rien à annuler
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
      this.log.warn(`[${this.name}] envoi impossible`, err)
    }
  }

  private spawn(): void {
    this._state = this._state === 'idle' ? 'starting' : 'restarting'
    this.ready = false
    let child: WorkerChild
    try {
      child = this.opts.fork(this.opts.modulePath, { serviceName: this.name })
    } catch (err) {
      this.log.error(`[${this.name}] lancement impossible`, err)
      this.handleExit(null, null, null)
      return
    }
    this.child = child
    child.onMessage((m) => {
      if (this.child === child) this.onMessage(m)
    })
    child.onExit((code, signal) => this.handleExit(child, code, signal))
  }

  private onMessage(m: unknown): void {
    if (isHello(m)) {
      if (this._state === 'stopping' || this._state === 'stopped') {
        // Arrêt demandé pendant le démarrage : dans Electron, `kill()` avant le spawn est sans
        // effet. `hello` prouve que le processus existe : on renvoie SIGTERM sans le déclarer prêt.
        try {
          this.child?.kill('SIGTERM')
        } catch {
          // déjà mort
        }
        return
      }
      this.ready = true
      this._state = 'ready'
      this.log.info(`[${this.name}] prêt (pid ${m.pid})`)
      if (this.config !== undefined) {
        // La configuration passe avant toute requête en attente.
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

  private handleExit(child: WorkerChild | null, code: number | null, signal: string | null): void {
    if (child && this.child !== child) return
    this.child = null
    this.ready = false
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.stableTimer = null

    if (this._state === 'stopping' || this._state === 'stopped') {
      this.finishStop()
      return
    }

    const interrupted: InterruptedCall[] = []
    for (const p of [...this.pending.values()]) {
      if (!p.sent) continue
      this.pending.delete(p.id)
      p.cleanup()
      if (p.internal) {
        // `__configure` est renvoyé automatiquement au redémarrage.
        p.resolve(null)
        continue
      }
      const it: InterruptedCall = { requestId: p.id, op: p.op }
      if (p.opts.jobId !== undefined) it.jobId = p.opts.jobId
      interrupted.push(it)
      p.reject(
        new AppError('worker_crashed', `le worker ${this.name} s'est arrêté pendant ${p.op}`, {
          jobId: p.opts.jobId,
        }),
      )
    }
    const delays = this.opts.backoffMs ?? DEFAULT_BACKOFF_MS
    const restartInMs = delays[Math.min(this.attempt, delays.length - 1)] ?? 30_000
    this.attempt++
    this._state = 'restarting'
    this.log.warn(
      `[${this.name}] arrêt inattendu (code ${code ?? '–'}, signal ${signal ?? '–'}) ; ` +
        `redémarrage dans ${restartInMs} ms, ${interrupted.length} requête(s) interrompue(s)`,
    )
    try {
      this.opts.onCrash?.({ name: this.name, code, signal, interrupted, restartInMs })
    } catch (err) {
      this.log.error(`[${this.name}] onCrash a levé une erreur`, err)
    }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this._state !== 'restarting') return
      this.restarts++
      this.spawn()
    }, restartInMs)
  }

  /** Termine un arrêt demandé (sortie du worker ou filet de sécurité). Idempotent. */
  private finishStop(): void {
    this.child = null
    this.ready = false
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.stableTimer = null
    this._state = 'stopped'
    for (const p of this.pending.values()) {
      p.cleanup()
      p.reject(new AppError('cancelled', `worker ${this.name} arrêté`))
    }
    this.pending.clear()
    const waiters = this.exitWaiters
    this.exitWaiters = []
    for (const w of waiters) w()
  }

  /** Arrêt propre : SIGTERM, puis SIGKILL après `stopTimeoutMs` (3 s). Idempotent. */
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopPromise = new Promise<void>((resolve) => {
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
          // déjà mort
        }
        // Filet de sécurité : sans événement `exit`, l'arrêt ne doit jamais bloquer la fermeture.
        // Appel direct (pas `handleExit`) : `this.child` peut déjà avoir changé.
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
        // déjà mort
      }
    }).finally(() => hosts.delete(this))
    return this.stopPromise
  }
}

/** Arrête tous les workers (fermeture de l'app). */
export async function stopAll(): Promise<void> {
  await Promise.all([...hosts].map((h) => h.stop()))
}

/** Client typé du media-worker. */
export interface MediaWorker {
  readonly host: WorkerHost
  call<O extends MediaOp>(op: O, args: MediaArgs<O>, opts?: CallOptions): Promise<MediaResult<O>>
  /** Chemins des outils (après « Re-détecter ») ; renvoyés à chaque redémarrage. */
  setTools(tools: MediaTools): Promise<void>
  stop(): Promise<void>
}

export const MEDIA_SERVICE_NAME = 'recolt-media'

export function createMediaWorker(
  opts: Omit<WorkerHostOptions, 'name' | 'config'> & { tools: MediaTools },
): MediaWorker {
  const { tools, ...rest } = opts
  const host = new WorkerHost({ ...rest, name: MEDIA_SERVICE_NAME, config: { tools } })
  return {
    host,
    call: (op, args, o) => host.call(op, args, o) as Promise<never>,
    setTools: (t) => host.setConfig({ tools: t }),
    stop: () => host.stop(),
  }
}
