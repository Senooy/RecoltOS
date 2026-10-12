/**
 * Preload sandboxé (CJS autonome, `contextIsolation: true`) : n'importe que `electron`
 * et des constantes sans dépendance. Expose `window.recolt`.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { RpcResult } from '../shared/errors'
import { EVENT_PREFIX, PRELOAD_ARG, RAW_CHANNELS } from '../shared/ipc/channels'
import { EVENT_NAME_LIST } from '../shared/ipc/event-names'
import type { RecoltApi, RecoltFlags } from './api'

const KNOWN_EVENTS: ReadonlySet<string> = new Set(EVENT_NAME_LIST)

function readFlags(argv: readonly string[]): RecoltFlags {
  const theme = argv.find((a) => a.startsWith(PRELOAD_ARG.theme))?.slice(PRELOAD_ARG.theme.length)
  return { theme: theme === 'dark' ? 'dark' : 'light', e2e: argv.includes(PRELOAD_ARG.e2e) }
}

const api: RecoltApi = {
  invoke: (channel, input) =>
    ipcRenderer.invoke(RAW_CHANNELS.rpc, channel, input) as Promise<RpcResult<unknown>>,
  on: (event, cb) => {
    if (!KNOWN_EVENTS.has(event)) throw new Error(`événement inconnu : ${event}`)
    const channel = `${EVENT_PREFIX}${event}`
    const listener = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.off(channel, listener)
    }
  },
  startDrag: (uuids, iconDataUrl) => {
    ipcRenderer.send(RAW_CHANNELS.drag, { uuids, iconDataUrl })
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  perfMark: (name) => {
    ipcRenderer.send(RAW_CHANNELS.perfMark, { name, t: performance.now() })
  },
  onFlushRequest: (cb) => {
    const listener = (_e: unknown, token: unknown) => {
      if (typeof token === 'string') cb(token)
    }
    ipcRenderer.on(RAW_CHANNELS.flushRequest, listener)
    return () => {
      ipcRenderer.off(RAW_CHANNELS.flushRequest, listener)
    }
  },
  flushDone: (token) => {
    ipcRenderer.send(RAW_CHANNELS.flushDone, token)
  },
  applyBatchSync: (payload) =>
    ipcRenderer.sendSync(RAW_CHANNELS.applyBatchSync, payload) as unknown,
  flags: readFlags(process.argv),
}

contextBridge.exposeInMainWorld('recolt', api)
