/**
 * Appels IPC typés de bout en bout : `rpc('items.list', {...})` → `Out<'items.list'>`.
 * Le renderer n'utilise jamais `window.recolt.invoke` directement.
 */
import type { AppErrorCode } from '../../../shared/errors'
import type { Channel, EventName, EventPayload, In, Out } from '../../../shared/ipc'
import { getApi } from '../api/client'

export class RpcError extends Error {
  readonly code: AppErrorCode
  readonly details: unknown

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.details = details
  }
}

type RpcArgs<C extends Channel> = undefined extends In<C> ? [input?: In<C>] : [input: In<C>]

export async function rpc<C extends Channel>(channel: C, ...args: RpcArgs<C>): Promise<Out<C>> {
  const res = await getApi().invoke(channel, args[0])
  if (res.ok) return res.data as Out<C>
  throw new RpcError(res.error.code, res.error.message, res.error.details)
}

export function isNotImplemented(err: unknown): boolean {
  return err instanceof RpcError && err.code === 'not_implemented'
}

/** Abonnement typé à `evt:<event>`. */
export function subscribe<E extends EventName>(
  event: E,
  cb: (payload: EventPayload<E>) => void,
): () => void {
  return getApi().on(event, (p) => cb(p as EventPayload<E>))
}
