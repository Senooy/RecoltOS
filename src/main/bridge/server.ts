/**
 * `BridgeServer` (SYNC §1.4, PLAN §1.18) : socket Unix 0600 dans `os.tmpdir()`, NDJSON, un hôte natif
 * par connexion. Premier message attendu : `host.hello` (protocole 1, sinon `PROTOCOL_MISMATCH` et
 * fermeture). Les messages suivants sont validés (`parseMessage`) puis distribués par `type`.
 * Clients gardés en mémoire (aucune table). `send` refuse tout message de plus de 900 Ko.
 * Sans `electron` : testable sous Node.
 */
import { chmodSync, existsSync, rmSync } from 'node:fs'
import net from 'node:net'
import {
  BRIDGE_PROTOCOL_VERSION,
  MAX_APP_TO_EXT_BYTES,
  type BridgePlatform,
} from '../../shared/bridge/constants'
import { envelope, type MessageType } from '../../shared/bridge/envelope'
import {
  HostHello,
  parseMessage,
  type PayloadOf,
  type PlatformsState,
  type TypedMessage,
} from '../../shared/bridge/messages'
import { LineDecoder } from '../../host/framing'

export interface BridgeClient {
  connId: number
  browser: string
  origin: string
  hostPid: number
  hostVersion: string
  extVersion: string | null
  target: 'chromium' | 'firefox' | null
  browserName: string | null
  profileId: string | null
  platforms: PlatformsState | null
  connectedAt: number
  lastSeenAt: number
  /** `hello` reçu : l'extension est réellement connectée (pas seulement l'hôte). */
  ready: boolean
}

export type Handler<T extends MessageType> = (
  msg: TypedMessage<T>,
  client: BridgeClient,
) => void | Promise<void>

export interface BridgeLogger {
  info(...a: unknown[]): void
  warn(...a: unknown[]): void
}

interface Conn {
  id: number
  socket: net.Socket
  client: BridgeClient | null
}

export class BridgeServer {
  readonly socketPath: string
  private readonly log: BridgeLogger
  private readonly now: () => number
  private server: net.Server | null = null
  private conns = new Map<number, Conn>()
  private nextId = 1
  private handlers = new Map<string, Handler<MessageType>>()
  private clientListeners = new Set<() => void>()

  constructor(socketPath: string, log: BridgeLogger, now: () => number = Date.now) {
    this.socketPath = socketPath
    this.log = log
    this.now = now
  }

  /** Gestionnaire d'un type de message (un seul par type). */
  handle<T extends MessageType>(type: T, fn: Handler<T>): this {
    this.handlers.set(type, fn as unknown as Handler<MessageType>)
    return this
  }

  /** Changement de la liste des clients ou de leur état ; rend la fonction de retrait. */
  onClients(fn: () => void): () => void {
    this.clientListeners.add(fn)
    return () => this.clientListeners.delete(fn)
  }

  private emitClients(): void {
    for (const fn of this.clientListeners) {
      try {
        fn()
      } catch (err) {
        this.log.warn('[bridge] écouteur clients', err)
      }
    }
  }

  async start(): Promise<void> {
    if (existsSync(this.socketPath)) rmSync(this.socketPath, { force: true })
    const server = net.createServer((socket) => this.accept(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.socketPath, () => {
        server.off('error', reject)
        resolve()
      })
    })
    chmodSync(this.socketPath, 0o600)
    server.on('error', (err) => this.log.warn('[bridge] serveur', err))
    this.server = server
  }

  async stop(): Promise<void> {
    for (const c of this.conns.values()) c.socket.destroy()
    this.conns.clear()
    const s = this.server
    this.server = null
    if (s) await new Promise<void>((r) => s.close(() => r()))
    rmSync(this.socketPath, { force: true })
    this.emitClients()
  }

  /** Clients dont l'extension a dit `hello`. */
  clients(): BridgeClient[] {
    return [...this.conns.values()]
      .map((c) => c.client)
      .filter((c): c is BridgeClient => c !== null && c.ready)
  }

  /** Hôtes connectés (même sans `hello`). */
  hosts(): BridgeClient[] {
    return [...this.conns.values()].map((c) => c.client).filter((c): c is BridgeClient => !!c)
  }

  getClient(connId: number): BridgeClient | null {
    return this.conns.get(connId)?.client ?? null
  }

  /** Client choisi pour une plateforme : session active, puis le plus récemment vu (SYNC §3.7). */
  pickClient(p: BridgePlatform): BridgeClient | null {
    const ready = this.clients()
    const logged = ready.filter((c) => c.platforms?.[p]?.loggedIn)
    const pool = logged.length ? logged : []
    return pool.sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0] ?? null
  }

  /** Envoie un message ; `false` s'il dépasse 900 Ko (refusé) ou si la connexion n'existe plus. */
  send<T extends MessageType>(
    connId: number,
    type: T,
    payload: PayloadOf<T> | undefined,
    re?: string,
  ): boolean {
    const c = this.conns.get(connId)
    if (!c || c.socket.destroyed) return false
    const msg = envelope(type, payload, re, this.now())
    const line = JSON.stringify(msg)
    if (Buffer.byteLength(line) > MAX_APP_TO_EXT_BYTES) {
      this.log.warn(`[bridge] message ${type} refusé (> 900 Ko)`)
      if (type !== 'error') {
        this.send(connId, 'error', { code: 'MESSAGE_TOO_LARGE', type }, re ?? msg.id)
      }
      return false
    }
    c.socket.write(`${line}\n`)
    return true
  }

  broadcast<T extends MessageType>(type: T, payload: PayloadOf<T> | undefined): void {
    for (const c of this.clients()) this.send(c.connId, type, payload)
  }

  private accept(socket: net.Socket): void {
    const conn: Conn = { id: this.nextId++, socket, client: null }
    this.conns.set(conn.id, conn)
    socket.setEncoding('utf8')
    const lines = new LineDecoder()
    socket.on('data', (d: string) => {
      const got = lines.push(d)
      if (!got) {
        this.log.warn('[bridge] ligne trop longue, connexion fermée')
        socket.destroy()
        return
      }
      for (const line of got) this.onLine(conn, line)
    })
    socket.on('error', () => undefined)
    socket.on('close', () => {
      this.conns.delete(conn.id)
      if (conn.client) this.emitClients()
    })
  }

  private onLine(conn: Conn, line: string): void {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      this.log.warn('[bridge] ligne invalide')
      return
    }
    if (!conn.client) {
      this.onHostHello(conn, raw)
      return
    }
    const r = parseMessage(raw)
    const client = conn.client
    client.lastSeenAt = this.now()
    if (!r.ok) {
      this.log.warn(`[bridge] message refusé : ${r.error}`)
      if (r.id) this.send(conn.id, 'error', { code: 'VALIDATION', message: r.error }, r.id)
      return
    }
    const m = r.message
    if (m.type === 'hello') {
      const p = m.payload
      client.extVersion = p.extVersion
      client.target = p.target
      client.browserName = p.browser.name
      client.profileId = p.profileId
      client.platforms = p.platforms
      client.ready = true
      this.emitClients()
    } else if (m.type === 'ext.status') {
      client.platforms = m.payload.platforms
      this.emitClients()
    } else if (m.type === 'ping') {
      this.send(conn.id, 'pong', undefined, m.id)
      return
    }
    const h = this.handlers.get(m.type)
    if (!h) return
    try {
      const res = h(m, client)
      if (res instanceof Promise) {
        res.catch((err: unknown) => this.log.warn(`[bridge] ${m.type}`, err))
      }
    } catch (err) {
      this.log.warn(`[bridge] ${m.type}`, err)
    }
  }

  private onHostHello(conn: Conn, raw: unknown): void {
    const r = parseMessage(raw)
    const hello =
      r.ok && r.message.type === 'host.hello' ? HostHello.safeParse(r.message.payload) : null
    if (!hello?.success) {
      const proto = (raw as { payload?: { protocol?: unknown } } | null)?.payload?.protocol
      const id = (raw as { id?: unknown } | null)?.id
      const re = typeof id === 'string' ? id : undefined
      this.send(
        conn.id,
        'error',
        typeof proto === 'number' && proto !== BRIDGE_PROTOCOL_VERSION
          ? { code: 'PROTOCOL_MISMATCH', appProtocol: BRIDGE_PROTOCOL_VERSION }
          : { code: 'VALIDATION', message: 'host.hello attendu' },
        re,
      )
      conn.socket.end()
      return
    }
    const h = hello.data
    if (h.protocol !== BRIDGE_PROTOCOL_VERSION) {
      this.send(conn.id, 'error', {
        code: 'PROTOCOL_MISMATCH',
        appProtocol: BRIDGE_PROTOCOL_VERSION,
      })
      conn.socket.end()
      return
    }
    const t = this.now()
    conn.client = {
      connId: conn.id,
      browser: h.browser,
      origin: h.origin,
      hostPid: h.pid,
      hostVersion: h.hostVersion,
      extVersion: null,
      target: null,
      browserName: null,
      profileId: null,
      platforms: null,
      connectedAt: t,
      lastSeenAt: t,
      ready: false,
    }
    this.emitClients()
  }
}
