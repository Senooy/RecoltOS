/**
 * Raw Electron channel names. No zod: imported by the sandboxed preload.
 */
export const RAW_CHANNELS = {
  /** `ipcRenderer.invoke('rpc', channel, input)` → `RpcResult`. */
  rpc: 'rpc',
  /** `send` renderer → main : `{ uuids, iconDataUrl? }`. */
  drag: 'drag',
  /** `send` renderer → main : `{ name, t }`. */
  perfMark: 'perf:mark',
  /** main → renderer: flush token before closing. */
  flushRequest: 'app:flush-request',
  /** renderer → main: token received. */
  flushDone: 'app:flush-done',
  /** `sendSync`, reserved for `beforeunload`, ≤ 2,000 nodes. */
  applyBatchSync: 'spaces:applyBatchSync',
} as const

/** Prefix of main → renderer events (`evt:<name>`). */
export const EVENT_PREFIX = 'evt:'

/** Extra arguments passed to the preload (`webPreferences.additionalArguments`). */
export const PRELOAD_ARG = {
  theme: '--recolt-theme=',
  e2e: '--recolt-e2e',
  /** Effective language at launch (`fr` | `en`): first render in the right language. */
  lang: '--recolt-lang=',
  /** System language (`fr` | `en`): resolves `ui.language: 'system'` on the renderer side. */
  systemLang: '--recolt-system-lang=',
} as const
