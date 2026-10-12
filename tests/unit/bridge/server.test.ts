/**
 * `BridgeServer`: `host.hello` required, protocol check, in-memory clients,
 * refusal of app → ext messages over 900 KB, socket 0600 and path < 104 bytes.
 */
import { statSync } from 'node:fs'
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { EXTENSION_ORIGIN } from '../../../src/shared/bridge/constants'
import { socketPath } from '../../../src/main/bridge/paths'
import { BridgeServer } from '../../../src/main/bridge/server'
import { makeTmpDir } from '../../helpers/tmpdir'

const log = { info: () => undefined, warn: () => undefined }
const id = () => globalThis.crypto.randomUUID()
const servers: BridgeServer[] = []
afterEach(async () => {
  for (const s of servers.splice(0)) await s.stop()
})

async function start(): Promise<BridgeServer> {
  const s = new BridgeServer(socketPath(makeTmpDir('srv')), log)
  servers.push(s)
  await s.start()
  return s
}

function client(path: string) {
  const sock = net.createConnection(path)
  sock.setEncoding('utf8')
  const got: { type: string; re?: string; payload?: Record<string, unknown> }[] = []
  let acc = ''
  sock.on('data', (d: string) => {
    acc += d
    let i
    while ((i = acc.indexOf('\n')) >= 0) {
      got.push(JSON.parse(acc.slice(0, i)) as (typeof got)[number])
      acc = acc.slice(i + 1)
    }
  })
  const closed = new Promise<void>((r) => sock.on('close', () => r()))
  return {
    sock,
    got,
    closed,
    send: (m: unknown) => sock.write(`${JSON.stringify(m)}\n`),
    until: async (pred: () => boolean, ms = 2_000) => {
      const t0 = Date.now()
      while (!pred()) {
        if (Date.now() - t0 > ms) throw new Error('timed out')
        await new Promise((r) => setTimeout(r, 10))
      }
    },
  }
}

const hostHello = (protocol = 1) => ({
  v: 1,
  id: id(),
  type: 'host.hello',
  payload: { protocol, browser: 'firefox', origin: EXTENSION_ORIGIN, hostVersion: '1.0.0', pid: 1 },
})

const hello = () => ({
  v: 1,
  id: id(),
  type: 'hello',
  payload: {
    extVersion: '1.0.0',
    protocol: 1,
    target: 'firefox',
    browser: { name: 'Firefox', version: '157' },
    profileId: null,
    platforms: {
      x: { loggedIn: true, accountId: '42' },
      instagram: { loggedIn: false },
      cosmos: { loggedIn: false },
    },
    openTabs: { x: 0, instagram: 0, cosmos: 0 },
  },
})

describe('BridgeServer', () => {
  it('socket 0600, path < 104 bytes even for a 200-character userData', async () => {
    const s = await start()
    expect(statSync(s.socketPath).mode & 0o777).toBe(0o600)
    const long = `/Users/test/${'x'.repeat(200)}`
    expect(Buffer.byteLength(socketPath(long))).toBeLessThan(104)
    expect(socketPath(long, `/var/${'t'.repeat(120)}`).startsWith('/tmp/recolt-')).toBe(true)
  })

  it('first message other than host.hello → refusal and close', async () => {
    const s = await start()
    const c = client(s.socketPath)
    c.send(hello())
    await c.closed
    expect(c.got[0]?.type).toBe('error')
    expect(c.got[0]?.payload?.code).toBe('VALIDATION')
  })

  it('different protocol → PROTOCOL_MISMATCH', async () => {
    const s = await start()
    const c = client(s.socketPath)
    c.send(hostHello(2))
    await c.closed
    expect(c.got[0]?.payload).toMatchObject({ code: 'PROTOCOL_MISMATCH', appProtocol: 1 })
  })

  it('in-memory clients: visible after hello, chosen per session, removed on close', async () => {
    const s = await start()
    let changes = 0
    s.onClients(() => changes++)
    const c = client(s.socketPath)
    c.send(hostHello())
    await c.until(() => s.hosts().length === 1)
    expect(s.clients()).toEqual([])
    const acks: string[] = []
    s.handle('hello', (m, cl) => {
      acks.push(m.id)
      s.send(cl.connId, 'pong', undefined, m.id)
    })
    const h = hello()
    c.send(h)
    await c.until(() => c.got.some((m) => m.type === 'pong'))
    expect(acks).toEqual([h.id])
    expect(s.clients()).toHaveLength(1)
    expect(s.pickClient('x')?.browser).toBe('firefox')
    expect(s.pickClient('instagram')).toBeNull()
    c.sock.end()
    await c.until(() => s.hosts().length === 0)
    expect(changes).toBeGreaterThanOrEqual(3)
  })

  it('invalid message → VALIDATION with re; over 900 KB refused', async () => {
    const s = await start()
    const c = client(s.socketPath)
    c.send(hostHello())
    c.send(hello())
    await c.until(() => s.clients().length === 1)
    const bad = { v: 1, id: id(), type: 'sync.run', payload: { platform: 'facebook' } }
    c.send(bad)
    await c.until(() => c.got.some((m) => m.re === bad.id))
    expect(c.got.find((m) => m.re === bad.id)?.payload?.code).toBe('VALIDATION')
    const cl = s.clients()[0]!
    const big = {
      collections: [{ id: 'a', name: 'x'.repeat(950_000), color: null, parentId: null, count: 0 }],
    }
    expect(s.send(cl.connId, 'collections.list.result', big)).toBe(false)
    await c.until(() => c.got.some((m) => m.payload?.code === 'MESSAGE_TOO_LARGE'))
  })
})
