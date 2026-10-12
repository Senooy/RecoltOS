/**
 * Shared access to the bridge (IPC handlers `bridge.*`, sync coordinator): server, registration
 * service, extension state. Filled in by `bridge/init.ts`.
 */
import type { HelloAck } from '../../shared/bridge/messages'
import type { BridgeServer } from './server'
import type { SaveService } from './save-service'

export interface BridgeRuntime {
  server: BridgeServer
  saves: SaveService
  userData: string
  home: string
  isPackaged: boolean
  hostName: string
  hostExe: string
  socket: string
  inbox: string
  resourcesPath: string
  appRoot: string
  /** Clients whose extension is older than the bundled one (`ext.stale`), by `connId`. */
  stale: Set<number>
}

let current: BridgeRuntime | null = null

export function setBridgeRuntime(r: BridgeRuntime | null): void {
  current = r
}

export function getBridgeRuntime(): BridgeRuntime | null {
  return current
}

/** Settings sent in `hello.ack` (provided by sync). */
export type HelloSettingsProvider = () => HelloAck['settings']

const DEFAULT_SETTINGS: HelloAck['settings'] = {
  sync: { x: false, instagram: false, cosmos: false },
  allowBackgroundTab: { x: false, instagram: false, cosmos: false },
  intervalsMin: { x: 15, instagram: 30, cosmos: 30 },
  maxPages: { x: 10, instagram: 5, cosmos: 5 },
  wantedAuthors: [],
}

let settingsProvider: HelloSettingsProvider = () => DEFAULT_SETTINGS

export function setHelloSettingsProvider(fn: HelloSettingsProvider | null): void {
  settingsProvider = fn ?? (() => DEFAULT_SETTINGS)
}

export function helloSettings(): HelloAck['settings'] {
  return settingsProvider()
}

/** `1.2.0` < `1.10.0` (numeric comparison per segment). */
export function isOlderVersion(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}
