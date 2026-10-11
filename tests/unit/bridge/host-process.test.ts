/**
 * Hôte natif lancé comme un navigateur le ferait (WP-52) : bundle `host.js` copié SEUL dans un dossier
 * sans `node_modules`, trames sur stdin/stdout, socket de l'app factice, spool.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { copyFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildHost } from '../../../scripts/build-host.mjs'
import { EXTENSION_ORIGIN, GECKO_ID } from '../../../src/shared/bridge/constants'
import { encodeFrame, FrameDecoder } from '../../../src/host/framing'
import { Inbox } from '../../../src/main/bridge/inbox'
import { socketPath } from '../../../src/main/bridge/paths'
import { makeTmpDir } from '../../helpers/tmpdir'

let hostJs = ''
const procs: ChildProcessWithoutNullStreams[] = []
const servers: net.Server[] = []

beforeAll(async () => {
  const build = makeTmpDir('host-build')
  const out = await buildHost({ outfile: join(build, 'host.js'), logLevel: 'silent' })
  const alone = makeTmpDir('host-alone')
  hostJs = join(alone, 'host.js')
  copyFileSync(out as string, hostJs)
  expect(readdirSync(alone)).toEqual(['host.js'])
})

afterEach(() => {
  for (const p of procs.splice(0)) p.kill()
  for (const s of servers.splice(0)) s.close()
})

interface Run {
  proc: ChildProcessWithoutNullStreams
  messages: { type: string; re?: string; payload?: unknown }[]
  send(m: unknown): void
  waitFor(
    pred: (m: { type: string; re?: string; payload?: unknown }) => boolean,
    ms?: number,
  ): Promise<{ type: string; re?: string; payload?: unknown }>
}

function run(args: string[], env: Record<string, string>): Run {
  const proc = spawn(process.execPath, [hostJs, ...args], {
    env: { PATH: '/usr/bin:/bin', RECOLTOS_USER_DATA: makeTmpDir('host-ud'), ...env },
    cwd: os.tmpdir(),
  })
  procs.push(proc)
  const messages: Run['messages'] = []
  const dec = new FrameDecoder(1024 * 1024)
  const waiters: {
    pred: (m: Run['messages'][number]) => boolean
    resolve: (m: Run['messages'][number]) => void
  }[] = []
  proc.stdout.on('data', (c: Buffer) => {
    for (const ev of dec.push(c)) {
      if (ev.kind !== 'message') continue
      const m = ev.value as Run['messages'][number]
      messages.push(m)
      for (const w of waiters.splice(0)) {
        if (w.pred(m)) w.resolve(m)
        else waiters.push(w)
      }
    }
  })
  return {
    proc,
    messages,
    send: (m) => proc.stdin.write(encodeFrame(m, 64 * 1024 * 1024)),
    waitFor: (pred, ms = 5_000) =>
      new Promise((resolve, reject) => {
        const hit = messages.find(pred)
        if (hit) return resolve(hit)
        const t = setTimeout(() => reject(new Error('délai dépassé')), ms)
        waiters.push({
          pred,
          resolve: (m) => {
            clearTimeout(t)
            resolve(m)
          },
        })
      }),
  }
}

const id = () => globalThis.crypto.randomUUID()

describe('hôte natif (processus)', () => {
  it('ping → pong, sans node_modules ni app', async () => {
    const r = run([EXTENSION_ORIGIN], { RECOLTOS_SOCKET: join(os.tmpdir(), 'recolt-absent.sock') })
    const pid = id()
    r.send({ v: 1, id: pid, type: 'ping' })
    const pong = await r.waitFor((m) => m.type === 'pong')
    expect(pong.re).toBe(pid)
  })

  it('app arrêtée → APP_NOT_RUNNING en moins de 2 s ; app.status déconnecté', async () => {
    const r = run([EXTENSION_ORIGIN], { RECOLTOS_SOCKET: join(os.tmpdir(), 'recolt-absent.sock') })
    const t0 = Date.now()
    const mid = id()
    r.send({ v: 1, id: mid, type: 'sync.request', payload: {} })
    const err = await r.waitFor((m) => m.type === 'error' && m.re === mid)
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(err.payload).toEqual({ code: 'APP_NOT_RUNNING' })
    await r.waitFor((m) => m.type === 'app.status')
  })

  it('origine refusée → code 2 ; Firefox accepté par son identifiant', async () => {
    const bad = run(['chrome-extension://autre/'], {})
    const code = await new Promise<number | null>((r) => bad.proc.on('exit', r))
    expect(code).toBe(2)
    const ff = run(['/chemin/manifest.json', GECKO_ID], {})
    const pid = id()
    ff.send({ v: 1, id: pid, type: 'ping' })
    expect((await ff.waitFor((m) => m.type === 'pong')).re).toBe(pid)
  })

  it('app fermée : save.create spoolé (0600) puis ingéré au démarrage', async () => {
    const userData = makeTmpDir('host-spool')
    const inbox = join(userData, 'inbox')
    const r = run([EXTENSION_ORIGIN], { RECOLTOS_SOCKET: '', RECOLTOS_INBOX: inbox })
    const sid = id()
    r.send({
      v: 1,
      id: sid,
      type: 'save.create',
      payload: {
        kind: 'image',
        pageUrl: 'https://example.com/',
        srcUrl: 'https://example.com/a.png',
      },
    })
    const ack = await r.waitFor((m) => m.type === 'save.ack')
    expect(ack.re).toBe(sid)
    expect(ack.payload).toEqual({ status: 'queued' })
    const files = readdirSync(inbox).filter((n) => n.endsWith('.json'))
    expect(files).toHaveLength(1)
    expect(statSync(join(inbox, files[0] as string)).mode & 0o777).toBe(0o600)
    const saved: unknown[] = []
    const box = new Inbox({
      dir: inbox,
      save: (req) => {
        saved.push(req)
        return Promise.resolve({ status: 'saved', saveId: 'x' })
      },
      log: { info: () => undefined, warn: () => undefined },
    })
    expect(await box.drain()).toBe(1)
    expect(saved).toEqual([
      { kind: 'image', pageUrl: 'https://example.com/', srcUrl: 'https://example.com/a.png' },
    ])
    expect(readdirSync(inbox).filter((n) => n.endsWith('.json'))).toEqual([])
  })

  it('relaie vers le socket de l’app (host.hello) et retour vers l’extension', async () => {
    const userData = makeTmpDir('host-sock')
    const sock = socketPath(userData)
    const lines: string[] = []
    const server = net.createServer((s) => {
      s.setEncoding('utf8')
      let acc = ''
      s.on('data', (d: string) => {
        acc += d
        let i
        while ((i = acc.indexOf('\n')) >= 0) {
          const line = acc.slice(0, i)
          acc = acc.slice(i + 1)
          lines.push(line)
          const m = JSON.parse(line) as { id: string; type: string }
          if (m.type === 'hello') {
            s.write(
              `${JSON.stringify({ v: 1, id: id(), re: m.id, type: 'hello.ack', payload: { ok: 1 } })}\n`,
            )
          }
        }
      })
    })
    servers.push(server)
    await new Promise<void>((r) => server.listen(sock, r))
    const r = run([EXTENSION_ORIGIN], { RECOLTOS_SOCKET: sock, RECOLTOS_BROWSER: 'firefox' })
    await r.waitFor(
      (m) => m.type === 'app.status' && (m.payload as { connected: boolean }).connected,
    )
    const hid = id()
    r.send({ v: 1, id: hid, type: 'hello', payload: {} })
    const ack = await r.waitFor((m) => m.type === 'hello.ack')
    expect(ack.re).toBe(hid)
    const first = JSON.parse(lines[0] as string) as {
      type: string
      payload: Record<string, unknown>
    }
    expect(first.type).toBe('host.hello')
    expect(first.payload).toMatchObject({
      protocol: 1,
      browser: 'firefox',
      origin: EXTENSION_ORIGIN,
    })
  })

  it('sans variables : socket et spool lus dans host.json de l’app', async () => {
    const userData = makeTmpDir('host-json')
    const { writeFileSync } = await import('node:fs')
    const sock = socketPath(userData)
    const server = net.createServer((s) => s.on('data', () => undefined))
    servers.push(server)
    await new Promise<void>((r) => server.listen(sock, r))
    writeFileSync(
      join(userData, 'host.json'),
      JSON.stringify({ socket: sock, inbox: join(userData, 'inbox') }),
    )
    const r = run([EXTENSION_ORIGIN], { RECOLTOS_USER_DATA: userData })
    await r.waitFor(
      (m) => m.type === 'app.status' && (m.payload as { connected: boolean }).connected,
    )
  })

  it('le bundle ne requiert que des modules intégrés', () => {
    const code = readFileSync(hostJs, 'utf8')
    for (const m of code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
      expect(m[1]).toMatch(/^(node:)?[a-z_/]+$/)
    }
  })
})
