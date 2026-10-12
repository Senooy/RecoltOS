/**
 * Internal control messages main ↔ worker, in addition to `WorkerRequest/Response`
 * (`src/shared/worker-protocol.ts`). `__` prefix: never a business operation.
 */
export const CONTROL_OPS = {
  /** Passes the configuration (tool paths); sent again on every restart. */
  configure: '__configure',
  /** Cancels the request `args.id` (AbortSignal on the worker side). */
  cancel: '__cancel',
  ping: '__ping',
} as const

/** First message from a worker ready to receive. */
export interface WorkerHello {
  ready: true
  pid: number
}

export function isHello(m: unknown): m is WorkerHello {
  return typeof m === 'object' && m !== null && (m as WorkerHello).ready === true
}
