/**
 * Worker side: message transport (`process.parentPort` in an Electron utilityProcess,
 * `process.send` in a Node `child_process.fork`, used by the tests), p-queue queue,
 * error serialization. A failed operation never terminates the process.
 */
import PQueue from 'p-queue'
import { AppError } from '../../shared/errors'
import { mt } from '../i18n'
import type { WorkerRequest, WorkerResponse } from '../../shared/worker-protocol'
import { CONTROL_OPS, type WorkerHello } from './control'

/** Subset of `Electron.ParentPort` used here (no `electron` import in a worker). */
interface ParentPortLike {
  on(event: 'message', listener: (e: { data: unknown }) => void): unknown
  postMessage(message: unknown): void
}

export interface Transport {
  post(msg: WorkerResponse | WorkerHello): void
  onMessage(cb: (msg: unknown) => void): void
}

export function detectTransport(): Transport {
  const port = (process as unknown as { parentPort?: ParentPortLike }).parentPort
  if (port) {
    return {
      post: (m) => port.postMessage(m),
      onMessage: (cb) => {
        port.on('message', (e) => cb(e.data))
      },
    }
  }
  if (typeof process.send === 'function') {
    return {
      post: (m) => {
        process.send?.(m)
      },
      onMessage: (cb) => {
        process.on('message', cb)
      },
    }
  }
  throw new Error('worker started without a parent channel')
}

export function serializeError(err: unknown): { code: string; message: string; retryAt?: number } {
  if (err instanceof AppError) {
    const retryAt = (err.details as { retryAt?: unknown } | undefined)?.retryAt
    return typeof retryAt === 'number'
      ? { code: err.code, message: err.message, retryAt }
      : { code: err.code, message: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  return { code: 'internal', message }
}

function isRequest(m: unknown): m is WorkerRequest {
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof (m as WorkerRequest).id === 'number' &&
    typeof (m as WorkerRequest).op === 'string'
  )
}

export interface ServeOptions {
  transport?: Transport
  concurrency?: number
  /** Runs a business operation (`progress` emits `{ id, progress }`). */
  handle(
    op: string,
    args: unknown,
    ctx: { signal: AbortSignal; progress: (p: unknown) => void },
  ): Promise<unknown>
  /** Control operation `__configure` (tools, settings). */
  configure?(args: unknown): void
}

/** Worker service loop: returns the transport (for the tests). */
export function serve(opts: ServeOptions): Transport {
  const t = opts.transport ?? detectTransport()
  const queue = new PQueue({ concurrency: opts.concurrency ?? 4 })
  const inflight = new Map<number, AbortController>()

  t.onMessage((msg) => {
    if (!isRequest(msg)) return
    const { id, op, args } = msg
    if (op === CONTROL_OPS.configure) {
      try {
        opts.configure?.(args)
        t.post({ id, ok: true, result: null })
      } catch (err) {
        t.post({ id, ok: false, error: serializeError(err) })
      }
      return
    }
    if (op === CONTROL_OPS.cancel) {
      const target = (args as { id?: unknown } | null)?.id
      if (typeof target === 'number') inflight.get(target)?.abort()
      return
    }
    if (op === CONTROL_OPS.ping) {
      t.post({ id, ok: true, result: { pid: process.pid } })
      return
    }
    const ac = new AbortController()
    inflight.set(id, ac)
    void queue
      .add(async () => {
        if (ac.signal.aborted) throw new AppError('cancelled', mt().errors.operationCancelled)
        return opts.handle(op, args, {
          signal: ac.signal,
          progress: (p) => t.post({ id, progress: p }),
        })
      })
      .then(
        (result) => t.post({ id, ok: true, result }),
        (err: unknown) => t.post({ id, ok: false, error: serializeError(err) }),
      )
      .finally(() => inflight.delete(id))
  })
  t.post({ ready: true, pid: process.pid })
  return t
}
