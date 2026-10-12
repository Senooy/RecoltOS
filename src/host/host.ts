/**
 * Hôte native messaging : lancé par le navigateur via le wrapper `sh`
 * généré par l'app. Relaie les trames de l'extension vers le socket Unix de l'app (NDJSON) et
 * inversement. Pas de secret : contrôles = `allowed_origins` / `allowed_extensions` (navigateur),
 * origine dans `argv` (ici), version de protocole (app). App fermée : `save.create` sans `upload`
 * écrit dans le spool `inbox/`, tout le reste reçoit `APP_NOT_RUNNING`.
 *
 * stdout est réservé au protocole ; les journaux vont sur stderr.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {
  BRIDGE_PROTOCOL_VERSION,
  EXTENSION_ORIGIN,
  GECKO_ID,
  HOST_PING_MS,
  MAX_FROM_EXT_BYTES,
  MAX_TO_EXT_BYTES,
} from '../shared/bridge/constants'
import { encodeFrame, FrameDecoder, LineDecoder } from './framing'

export const HOST_VERSION = '1.0.0'

export interface HostIo {
  argv: readonly string[]
  /** Chemin de l'exécutable (choix du dossier de l'app : packagée ou développement). */
  execPath?: string
  home?: string
  ppid?: number
  env: Record<string, string | undefined>
  stdin: NodeJS.ReadableStream
  stdout: { write(b: Buffer): boolean }
  stderr: { write(s: string): boolean }
  exit(code: number): void
  pid: number
  now?: () => number
  /** Délai de reconnexion au socket (2 s). */
  reconnectMs?: number
  pingMs?: number
}

type Msg = { v: number; id: string; re?: string; type: string; ts?: number; payload?: unknown }

const uuid = () => globalThis.crypto.randomUUID()

/**
 * Origine appelante : Chrome passe `chrome-extension://<id>/` (1er argument), Firefox passe le chemin
 * du manifest puis l'identifiant de l'extension. On cherche l'une ou l'autre dans `argv`.
 */
export function callerOrigin(argv: readonly string[], allowed: readonly string[]): string | null {
  for (const a of argv) if (allowed.includes(a)) return a
  return null
}

export const DEFAULT_ALLOWED = [EXTENSION_ORIGIN, GECKO_ID]

/**
 * Dossier de données de l'app qui a installé l'hôte : `RECOLTOS_USER_DATA`, sinon
 * `~/Library/Application Support/RecoltOS` (exécutable dans un `.app`) ou `RecoltOS-dev`.
 */
export function appUserData(env: HostIo['env'], execPath: string, home: string): string {
  if (env.RECOLTOS_USER_DATA) return env.RECOLTOS_USER_DATA
  const name = /\.app\/Contents\//.test(execPath) ? 'RecoltOS' : 'RecoltOS-dev'
  return path.join(home, 'Library', 'Application Support', name)
}

/**
 * Socket et spool : variables d'environnement (tests), sinon `host.json` écrit par l'app à chaque
 * lancement. Le navigateur lance l'exécutable DIRECTEMENT (Chromium ne lance pas un script shell).
 */
export function hostConfig(
  env: HostIo['env'],
  execPath: string,
  home: string,
): { socket: string; inbox: string } {
  const dir = appUserData(env, execPath, home)
  let fromFile: { socket?: unknown; inbox?: unknown } = {}
  try {
    fromFile = JSON.parse(fs.readFileSync(path.join(dir, 'host.json'), 'utf8')) as typeof fromFile
  } catch {
    // app jamais lancée : l'extension saura qu'elle est fermée
  }
  return {
    socket: env.RECOLTOS_SOCKET ?? (typeof fromFile.socket === 'string' ? fromFile.socket : ''),
    inbox:
      env.RECOLTOS_INBOX ??
      (typeof fromFile.inbox === 'string' ? fromFile.inbox : path.join(dir, 'inbox')),
  }
}

/** Nom du processus parent (le navigateur), pour l'affichage dans les Réglages. */
export function parentName(ppid: number | undefined): string {
  if (!ppid) return 'unknown'
  try {
    const comm = execFileSync('/bin/ps', ['-o', 'comm=', '-p', String(ppid)], {
      encoding: 'utf8',
      timeout: 2_000,
    }).trim()
    const app = /\/([^/]+)\.app\/Contents\/MacOS\//.exec(comm)?.[1]
    return (app ?? path.basename(comm)).slice(0, 40) || 'unknown'
  } catch {
    return 'unknown'
  }
}

export function startHost(io: HostIo): { stop(): void } {
  const log = (s: string) => io.stderr.write(`[recoltos-host] ${s}\n`)
  const allowed = io.env.RECOLTOS_ALLOWED_ORIGINS
    ? io.env.RECOLTOS_ALLOWED_ORIGINS.split(',').filter(Boolean)
    : DEFAULT_ALLOWED
  const origin = callerOrigin(io.argv.slice(1), allowed)
  if (!origin) {
    log('origine refusée')
    io.exit(2)
    return { stop() {} }
  }
  const cfg = hostConfig(io.env, io.execPath ?? io.argv[0] ?? '', io.home ?? os.homedir())
  const sockPath = cfg.socket
  const inbox = cfg.inbox
  const browser = io.env.RECOLTOS_BROWSER ?? parentName(io.ppid)
  const now = io.now ?? Date.now
  let stopped = false

  const toExtension = (msg: Msg) => {
    const frame = encodeFrame(msg, MAX_TO_EXT_BYTES)
    if (!frame) {
      log(`message ${msg.type} non transmis (> 1 Mo)`)
      if (msg.type !== 'error') {
        toExtension({
          v: BRIDGE_PROTOCOL_VERSION,
          id: uuid(),
          re: msg.re ?? msg.id,
          type: 'error',
          ts: now(),
          payload: { code: 'MESSAGE_TOO_LARGE', type: msg.type },
        })
      }
      return
    }
    io.stdout.write(frame)
  }
  const reply = (re: string | undefined, type: string, payload?: unknown) => {
    const m: Msg = { v: BRIDGE_PROTOCOL_VERSION, id: uuid(), type, ts: now(), payload }
    if (re) m.re = re
    toExtension(m)
  }

  // ---- hôte ↔ app : socket Unix NDJSON
  let announced: boolean | null = null
  /** `app.status` envoyé à chaque changement d'état (et au premier échec de connexion). */
  const announce = (connected: boolean) => {
    if (announced === connected) return
    announced = connected
    reply(undefined, 'app.status', { connected })
  }
  let sock: net.Socket | null = null
  let gaveUp = false
  let reconnect: NodeJS.Timeout | null = null
  const connectApp = () => {
    if (gaveUp || stopped || !sockPath) return
    const s = net.createConnection(sockPath)
    const lines = new LineDecoder()
    s.setEncoding('utf8')
    s.on('connect', () => {
      sock = s
      s.write(
        `${JSON.stringify({
          v: BRIDGE_PROTOCOL_VERSION,
          id: uuid(),
          type: 'host.hello',
          ts: now(),
          payload: {
            protocol: BRIDGE_PROTOCOL_VERSION,
            browser,
            origin,
            hostVersion: HOST_VERSION,
            pid: io.pid,
          },
        })}\n`,
      )
      reply(undefined, 'app.status', { connected: true })
    })
    s.on('data', (d: string) => {
      const got = lines.push(d)
      if (!got) {
        log('ligne de l’app trop longue')
        s.destroy()
        return
      }
      for (const line of got) {
        let m: Msg
        try {
          m = JSON.parse(line) as Msg
        } catch {
          log('ligne de l’app invalide')
          continue
        }
        const p = m.payload as { code?: string } | undefined
        if (m.type === 'error' && p?.code === 'PROTOCOL_MISMATCH') gaveUp = true
        toExtension(m)
      }
    })
    s.on('error', () => undefined)
    s.on('close', () => {
      if (sock === s) sock = null
      announce(false)
      if (!stopped && !gaveUp) {
        reconnect = setTimeout(connectApp, io.reconnectMs ?? 2_000)
        reconnect.unref?.()
      }
    })
  }

  const spool = (msg: Msg): boolean => {
    if (!inbox) return false
    try {
      fs.mkdirSync(inbox, { recursive: true, mode: 0o700 })
      const f = path.join(inbox, `${now()}-${msg.id}.json`)
      fs.writeFileSync(`${f}.tmp`, JSON.stringify(msg), { mode: 0o600 })
      fs.renameSync(`${f}.tmp`, f)
      return true
    } catch (err) {
      log(`spool impossible : ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  const onFromExtension = (msg: Msg) => {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return
    if (msg.type === 'ping') return reply(msg.id, 'pong')
    if (msg.type === 'pong') return
    if (sock) {
      sock.write(`${JSON.stringify(msg)}\n`)
      return
    }
    const payload = msg.payload as { upload?: unknown } | undefined
    if (msg.type === 'save.create' && !payload?.upload && spool(msg)) {
      return reply(msg.id, 'save.ack', { status: 'queued' })
    }
    if (msg.type === 'hello' || msg.type === 'ext.status') {
      // L'extension renverra `hello` quand `app.status` passera à connecté.
      announced = null
      return announce(false)
    }
    reply(msg.id, 'error', { code: 'APP_NOT_RUNNING' })
  }

  // ---- extension → hôte
  const decoder = new FrameDecoder(MAX_FROM_EXT_BYTES)
  const onData = (chunk: Buffer) => {
    for (const ev of decoder.push(chunk)) {
      if (ev.kind === 'message') onFromExtension(ev.value as Msg)
      else if (ev.kind === 'invalid') log(`trame ignorée : ${ev.reason}`)
      else {
        log(`fermeture : ${ev.reason}`)
        shutdown(4)
        return
      }
    }
  }
  io.stdin.on('data', onData)
  io.stdin.on('end', () => shutdown(0))

  const ping = setInterval(() => reply(undefined, 'ping'), io.pingMs ?? HOST_PING_MS)
  ping.unref?.()

  function shutdown(code: number) {
    if (stopped) return
    stopped = true
    clearInterval(ping)
    if (reconnect) clearTimeout(reconnect)
    sock?.end()
    io.exit(code)
  }

  connectApp()
  // Sans socket configuré, l'app est considérée fermée : l'extension le sait tout de suite.
  if (!sockPath) announce(false)
  return { stop: () => shutdown(0) }
}
