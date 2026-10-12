/**
 * API exposed to the renderer under `window.recolt`. The renderer only calls the typed
 * `rpc<C>()` (`src/renderer/src/lib/rpc.ts`), never `invoke` directly.
 */
import type { RpcResult } from '../shared/errors'

export interface RecoltFlags {
  /** Effective theme at launch (color of the first frame). */
  theme: 'light' | 'dark'
  /** `RECOLTOS_E2E=1`: animations disabled, videos without autoplay. */
  e2e: boolean
  /** Effective language at launch (first render). */
  lang: 'fr' | 'en'
  /** System language: resolves `ui.language: 'system'` when the setting changes. */
  systemLang: 'fr' | 'en'
}

export interface RecoltApi {
  /** Single `rpc` channel: returns an envelope, does not throw for an application error. */
  invoke(channel: string, input?: unknown): Promise<RpcResult<unknown>>
  /** Subscription to `evt:<event>`; returns the unsubscribe function. */
  on(event: string, cb: (payload: unknown) => void): () => void
  /** Native drag: to call during `dragstart` (128 px PNG as a dataURL). */
  startDrag(uuids: string[], iconDataUrl?: string): void
  /** `webUtils.getPathForFile` (File.path no longer exists since Electron 32). */
  pathForFile(file: File): string
  perfMark(name: string): void
  /** Flush requests before closing (`app:flush-request`). */
  onFlushRequest(cb: (token: string) => void): () => void
  flushDone(token: string): void
  /** `spaces:applyBatchSync`: reserved for `beforeunload`, ≤ 2,000 nodes. */
  applyBatchSync(payload: unknown): unknown
  readonly flags: RecoltFlags
}

declare global {
  interface Window {
    recolt?: RecoltApi
  }
}
