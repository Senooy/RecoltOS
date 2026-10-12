/**
 * Vidage avant fermeture : main envoie `app:flush-request(token)` ; chaque
 * domaine enregistre un vidage (Spaces : `commitEditing()` puis `persistence.flush()`) ; le
 * renderer répond `flushDone(token)` quand tout est terminé (main attend 2 s au plus).
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
