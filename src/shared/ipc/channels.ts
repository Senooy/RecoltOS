/**
 * Noms des canaux Electron bruts. Sans zod : importé par le preload sandboxé.
 */
export const RAW_CHANNELS = {
  /** `ipcRenderer.invoke('rpc', channel, input)` → `RpcResult`. */
  rpc: 'rpc',
  /** `send` renderer → main : `{ uuids, iconDataUrl? }`. */
  drag: 'drag',
  /** `send` renderer → main : `{ name, t }`. */
  perfMark: 'perf:mark',
  /** main → renderer : jeton de vidage avant fermeture. */
  flushRequest: 'app:flush-request',
  /** renderer → main : jeton reçu. */
  flushDone: 'app:flush-done',
  /** `sendSync`, réservé à `beforeunload`, ≤ 2 000 nœuds. */
  applyBatchSync: 'spaces:applyBatchSync',
} as const

/** Préfixe des événements main → renderer (`evt:<nom>`). */
export const EVENT_PREFIX = 'evt:'

/** Arguments supplémentaires passés au preload (`webPreferences.additionalArguments`). */
export const PRELOAD_ARG = {
  theme: '--recolt-theme=',
  e2e: '--recolt-e2e',
} as const
