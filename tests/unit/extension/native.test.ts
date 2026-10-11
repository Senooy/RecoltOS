/**
 * Port natif de l'extension (WP-53) : hello, reconnexion après déconnexion, repli sur l'hôte de dev,
 * classification des erreurs, requêtes (réponse, erreur `APP_NOT_RUNNING`, délai).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  BridgeError,
  classifyDisconnect,
  NativeBridge,
} from '../../../extension/src/background/native'
import { maybeReload } from '../../../extension/src/background/reload-guard'
import { FakeChrome, lastPort } from '../../helpers/fake-chrome'

let fake: FakeChrome
const timers: { fn: () => void; ms: number }[] = []
const hello = () =>
  Promise.resolve({
    extVersion: '1.0.0',
    protocol: 1,
    target: 'chromium' as const,
    browser: { name: 'Chrome', version: '1' },
    profileId: null,
    platforms: {
      x: { loggedIn: true },
      instagram: { loggedIn: false },
      cosmos: { loggedIn: false },
    },
    openTabs: { x: 0, instagram: 0, cosmos: 0 },
  })

function bridge(names?: string[]) {
  return new NativeBridge({
    hello,
    ...(names ? { hostNames: names } : {}),
    setTimer: (fn, ms) => {
      const t = { fn, ms }
      timers.push(t)
      return t
    },
    clearTimer: (t) => {
      const i = timers.indexOf(t as (typeof timers)[number])
      if (i >= 0) timers.splice(i, 1)
    },
  })
}
const flush = () => new Promise((r) => setTimeout(r, 0))
const types = (posted: unknown[]) => posted.map((m) => (m as { type: string }).type)

beforeEach(() => {
  fake = new FakeChrome()
  fake.install()
  timers.length = 0
})

describe('NativeBridge', () => {
  it('se connecte, envoie hello, puis renvoie hello quand l’app se connecte', async () => {
    const b = bridge()
    b.connect()
    await flush()
    const port = lastPort(fake)
    expect(port.name).toBe('com.recoltos.host')
    expect(types(port.posted)).toEqual(['hello'])
    port.receive({
      v: 1,
      id: crypto.randomUUID(),
      type: 'app.status',
      payload: { connected: true },
    })
    await flush()
    expect(b.state).toBe('app_connected')
    expect(types(port.posted)).toEqual(['hello', 'hello'])
  })

  it('reconnexion après onDisconnect avec backoff croissant', () => {
    const b = bridge(['com.recoltos.host'])
    b.connect()
    lastPort(fake).drop('Native host has exited.', fake)
    expect(b.state).toBe('host_exited')
    expect(timers.map((t) => t.ms)).toEqual([1_000])
    timers.shift()!.fn()
    expect(fake.ports).toHaveLength(2)
    lastPort(fake).drop('Native host has exited.', fake)
    expect(timers.map((t) => t.ms)).toEqual([2_000])
  })

  it('hôte absent : essaie com.recoltos.host.dev, puis host_missing', async () => {
    fake.missingHosts.add('com.recoltos.host')
    fake.missingHosts.add('com.recoltos.host.dev')
    const b = bridge()
    b.connect()
    await flush()
    await flush()
    expect(fake.ports.map((p) => p.name)).toEqual(['com.recoltos.host', 'com.recoltos.host.dev'])
    expect(b.state).toBe('host_missing')
  })

  it('classe les messages d’erreur Chrome et Firefox', () => {
    expect(classifyDisconnect('Specified native messaging host not found.')).toBe('host_missing')
    expect(classifyDisconnect('No such native application com.recoltos.host')).toBe('host_missing')
    expect(classifyDisconnect('Access to the specified native messaging host is forbidden.')).toBe(
      'host_forbidden',
    )
    expect(classifyDisconnect('Native host has exited.')).toBe('host_exited')
    expect(classifyDisconnect(undefined)).toBe('host_exited')
  })

  it('request : réponse par re, erreur APP_NOT_RUNNING remontée, délai', async () => {
    const b = bridge()
    b.connect()
    await flush()
    const port = lastPort(fake)
    const p1 = b.request('collections.list', {})
    const sent = port.posted.at(-1) as { id: string }
    port.receive({
      v: 1,
      id: crypto.randomUUID(),
      re: sent.id,
      type: 'collections.list.result',
      payload: { collections: [] },
    })
    expect((await p1).type).toBe('collections.list.result')
    const p2 = b.request('sync.request', { trigger: 'manual' })
    const s2 = port.posted.at(-1) as { id: string }
    port.receive({
      v: 1,
      id: crypto.randomUUID(),
      re: s2.id,
      type: 'error',
      payload: { code: 'APP_NOT_RUNNING' },
    })
    await expect(p2).rejects.toMatchObject({ code: 'APP_NOT_RUNNING' })
    const p3 = b.request('collections.list', {}, 5)
    timers.find((t) => t.ms === 5)!.fn()
    await expect(p3).rejects.toBeInstanceOf(BridgeError)
  })

  it('distribue les messages de l’app aux gestionnaires', () => {
    const b = bridge()
    const got: string[] = []
    b.on('sync.run', (m) => got.push(m.type))
    b.connect()
    lastPort(fake).receive({ v: 1, id: crypto.randomUUID(), type: 'sync.run', payload: {} })
    expect(got).toEqual(['sync.run'])
  })
})

describe('reload-guard', () => {
  it('un seul runtime.reload par version, puis ext.stale', async () => {
    const stale: unknown[] = []
    expect(await maybeReload('1.1.0', '1.0.0', (s) => stale.push(s))).toBe('reloaded')
    expect(await maybeReload('1.1.0', '1.0.0', (s) => stale.push(s))).toBe('stale')
    expect(fake.reloads).toBe(1)
    expect(stale).toEqual([{ extVersion: '1.0.0', bundledExtVersion: '1.1.0' }])
    expect(await maybeReload('1.2.0', '1.0.0', () => undefined)).toBe('reloaded')
    expect(fake.reloads).toBe(2)
  })
})
