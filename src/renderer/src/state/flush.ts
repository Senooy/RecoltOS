/**
 * Flush before closing: main sends `app:flush-request(token)`; each domain registers a flush
 * (Spaces: `commitEditing()` then `persistence.flush()`); the renderer replies `flushDone(token)`
 * once everything is finished (main waits 2 s at most).
 */
import type { RecoltApi } from '../../../preload/api'

type FlushFn = () => void | Promise<void>
const flushers = new Set<FlushFn>()

export function registerFlush(fn: FlushFn): () => void {
  flushers.add(fn)
  return () => {
    flushers.delete(fn)
  }
}

export async function flushAll(): Promise<void> {
  await Promise.allSettled([...flushers].map(async (fn) => fn()))
}

export function installFlushBridge(api: RecoltApi | undefined = window.recolt): () => void {
  if (!api) return () => undefined
  return api.onFlushRequest((token) => {
    void flushAll().finally(() => api.flushDone(token))
  })
}
