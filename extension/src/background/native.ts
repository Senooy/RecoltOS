/**
 * Port native messaging vers l'hôte RecoltOS (SYNC §1.8, §2.6) : connexion, classification des
 * erreurs de déconnexion, reconnexion avec backoff (1 à 60 s), requêtes avec délai, distribution des
 * messages de l'app. Essaie `com.recoltos.host` puis `com.recoltos.host.dev` (app de développement).
 */
import {
  BRIDGE_PROTOCOL_VERSION,
  NATIVE_HOST_NAME,
  NATIVE_HOST_NAME_DEV,
} from '../../../src/shared/bridge/constants'
import type { Envelope, MessageType } from '../../../src/shared/bridge/envelope'
import type { PayloadOf } from '../../../src/shared/bridge/messages'
import { api, lastErrorMessage } from '../lib/api'

export type BridgeState =
  | 'connecting'
  | 'app_connected'
  | 'app_closed'
  | 'host_missing'
  | 'host_forbidden'
  | 'host_exited'
  | 'protocol_mismatch'

/** Classe le message d'erreur d'une déconnexion (Chrome `lastError`, Firefox `port.error`). */
export function classifyDisconnect(message: string | undefined): BridgeState {
  const m = (message ?? '').toLowerCase()
  if (m.includes('not found') || m.includes('no such native application')) return 'host_missing'
  if (m.includes('forbidden') || m.includes('not allowed')) return 'host_forbidden'
  return 'host_exited'
}

export class BridgeError extends Error {
  readonly code: string
  constructor(code: string, message?: string) {
    super(message ?? code)
    this.code = code
  }
}

type Port = chrome.runtime.Port & { error?: { message?: string } }
type Listener = (m: Envelope) => void

export interface NativeBridgeOptions {
  hostNames?: string[]
  /** Contenu du `hello` (appelé à chaque connexion de l'app). */
  hello: () => Promise<PayloadOf<'hello'>>
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

export class NativeBridge {
  state: BridgeState = 'connecting'
  private port: Port | null = null
  private readonly names: string[]
  private nameIndex = 0
  private backoff = 1_000
  private retry: unknown = null
  private waiters = new Map<
    string,
    { resolve: (m: Envelope) => void; reject: (e: Error) => void; timer: unknown }
  >()
  private handlers = new Map<string, Listener[]>()
  private stateListeners = new Set<(s: BridgeState) => void>()
  private readonly opts: NativeBridgeOptions

  constructor(opts: NativeBridgeOptions) {
    this.opts = opts
    this.names = opts.hostNames ?? [NATIVE_HOST_NAME, NATIVE_HOST_NAME_DEV]
  }

  private setTimer(fn: () => void, ms: number): unknown {
    return (this.opts.setTimer ?? ((f, t) => setTimeout(f, t)))(fn, ms)
  }
  private clearTimer(t: unknown): void {
    ;(this.opts.clearTimer ?? ((x) => clearTimeout(x as ReturnType<typeof setTimeout>)))(t)
  }

  get connected(): boolean {
    return this.state === 'app_connected'
  }

  onState(fn: (s: BridgeState) => void): () => void {
    this.stateListeners.add(fn)
    return () => this.stateListeners.delete(fn)
  }

  private setState(s: BridgeState): void {
    if (this.state === s) return
    this.state = s
    for (const fn of this.stateListeners) fn(s)
  }

  /** Connexion (idempotente). */
  connect(): void {
    if (this.port) return
    if (this.retry) {
      this.clearTimer(this.retry)
      this.retry = null
    }
    const name = this.names[this.nameIndex] ?? NATIVE_HOST_NAME
    let port: Port
    try {
      port = api().runtime.connectNative(name)
    } catch (err) {
      this.onDisconnect(err instanceof Error ? err.message : String(err))
      return
    }
    this.port = port
    port.onMessage.addListener((m: Envelope) => this.dispatch(m))
    port.onDisconnect.addListener((p: Port) => {
      if (this.port !== port) return
      this.port = null
      this.onDisconnect(p.error?.message ?? port.error?.message ?? lastErrorMessage())
    })
    // L'hôte répondra `app.status` ; le `hello` part dès que l'app est connectée.
    void this.sendHello()
  }

  private onDisconnect(message: string | undefined): void {
    const s = classifyDisconnect(message)
    for (const [id, w] of this.waiters) {
      this.clearTimer(w.timer)
      w.reject(new BridgeError('DISCONNECTED'))
      this.waiters.delete(id)
    }
    // Hôte absent sous ce nom : on essaie le suivant tout de suite (une fois par tour).
    if (s === 'host_missing' && this.nameIndex < this.names.length - 1) {
      this.nameIndex += 1
      this.connect()
      return
    }
    this.nameIndex = 0
    this.setState(s)
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, 60_000)
    this.retry = this.setTimer(() => {
      this.retry = null
      this.connect()
    }, delay)
  }

  /** Reconnexion immédiate (alarme `watchdog`, réveil du script d'arrière-plan). */
  ensure(): void {
    if (!this.port && !this.retry) this.connect()
  }

  private async sendHello(): Promise<void> {
    try {
      this.post('hello', await this.opts.hello())
    } catch {
      // port fermé entre-temps : nouvel essai à la reconnexion
    }
  }

  post<T extends MessageType>(type: T, payload?: PayloadOf<T>, re?: string): string {
    const id = globalThis.crypto.randomUUID()
    const msg: Envelope = { v: BRIDGE_PROTOCOL_VERSION, id, type, ts: Date.now(), payload }
    if (re) msg.re = re
    if (!this.port) throw new BridgeError('NOT_CONNECTED')
    this.port.postMessage(msg)
    return id
  }

  /** Envoie et attend la réponse (`re`) ; une réponse `error` rejette avec son code. */
  request<T extends MessageType>(
    type: T,
    payload: PayloadOf<T>,
    timeoutMs = 30_000,
  ): Promise<Envelope> {
    return new Promise((resolve, reject) => {
      let id: string
      try {
        id = this.post(type, payload)
      } catch (e) {
        reject(e instanceof Error ? e : new BridgeError('NOT_CONNECTED'))
        return
      }
      const timer = this.setTimer(() => {
        this.waiters.delete(id)
        reject(new BridgeError('TIMEOUT'))
      }, timeoutMs)
      this.waiters.set(id, { resolve, reject, timer })
    })
  }

  on(type: MessageType, fn: Listener): () => void {
    const list = this.handlers.get(type) ?? []
    list.push(fn)
    this.handlers.set(type, list)
    return () => {
      const l = this.handlers.get(type) ?? []
      this.handlers.set(
        type,
        l.filter((f) => f !== fn),
      )
    }
  }

  private dispatch(m: Envelope): void {
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return
    if (m.type === 'app.status') {
      const connected = (m.payload as { connected?: boolean } | undefined)?.connected === true
      if (connected) {
        this.backoff = 1_000
        this.setState('app_connected')
        void this.sendHello()
      } else {
        this.setState('app_closed')
      }
    }
    if (m.type === 'error') {
      const code = (m.payload as { code?: string } | undefined)?.code
      if (code === 'PROTOCOL_MISMATCH') this.setState('protocol_mismatch')
      if (code === 'APP_NOT_RUNNING' && this.state === 'app_connected') this.setState('app_closed')
    }
    if (m.re) {
      const w = this.waiters.get(m.re)
      if (w) {
        this.waiters.delete(m.re)
        this.clearTimer(w.timer)
        if (m.type === 'error') {
          const p = m.payload as { code?: string; message?: string } | undefined
          w.reject(new BridgeError(p?.code ?? 'ERROR', p?.message))
        } else {
          w.resolve(m)
        }
        return
      }
    }
    for (const fn of this.handlers.get(m.type) ?? []) {
      try {
        fn(m)
      } catch {
        // un gestionnaire défaillant n'interrompt pas les autres
      }
    }
  }
}
