/**
 * `SyncCoordinator` (WP-57) : planning, backfill, backoff, auth_required, page refusée par le parseur,
 * et simulation de 24 h avec l'exécuteur réel de l'extension : aucun onglet créé sans l'option.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SyncRunner } from '../../../extension/src/background/sync/runner'
import { libraryPaths } from '../../../src/main/library/paths'
import type { LibraryContext } from '../../../src/main/library/library-context'
import {
  SyncCoordinator,
  type BridgePort,
  type ClientView,
} from '../../../src/main/sync/coordinator'
import { DEFAULT_PREFS } from '../../../src/shared/prefs'
import { FakeChrome } from '../../helpers/fake-chrome'
import { openTestLib, T0, type TestLib } from '../db/helpers'

const FIX = join(import.meta.dirname, '../../fixtures/sync')
const fx = (p: string) => JSON.parse(readFileSync(join(FIX, p), 'utf8')) as unknown

let t: TestLib
let lib: LibraryContext
beforeEach(() => {
  t = openTestLib()
  lib = {
    id: 'ltest',
    name: 'Test',
    root: t.root,
    paths: libraryPaths(t.root),
    db: t.db,
    repos: t.repos,
  }
})
afterEach(() => t.cleanup())

// ---------------------------------------------------------------------------- coordinateur

interface Sent {
  connId: number
  type: string
  payload: Record<string, unknown>
}

function coordinator(clients: ClientView[]) {
  const sent: Sent[] = []
  const port: BridgePort = {
    clients: () => clients,
    send: (connId, type, payload) => {
      sent.push({ connId, type, payload: payload })
      return true
    },
    broadcast: () => undefined,
  }
  let n = 0
  const c = new SyncCoordinator({
    lib: () => lib,
    bridge: () => port,
    prefs: () => DEFAULT_PREFS,
    now: () => t.clock.now,
    emitStatus: () => undefined,
    kickJobs: () => undefined,
    renderCards: () => undefined,
    gatherosConflict: () => false,
    clientsDto: () => [],
    log: { info: () => undefined, warn: () => undefined },
    newId: () => `run-${++n}`,
  })
  return { c, sent, port }
}

const firefox: ClientView = {
  connId: 1,
  label: 'Firefox',
  loggedIn: { x: true, instagram: true, cosmos: true },
  permission: { x: true, instagram: true, cosmos: true },
  lastSeenAt: T0,
}

describe('SyncCoordinator', () => {
  it('activation → backfill (toggle) ; pages suivies jusqu’à la fin ; backfill_done', () => {
    const { c, sent } = coordinator([firefox])
    c.setEnabled('x', true)
    const run = sent.find((s) => s.type === 'sync.run')!
    expect(run.payload).toMatchObject({
      platform: 'x',
      mode: 'backfill',
      trigger: 'toggle',
      maxPages: 50,
      allowBackgroundTab: false,
    })
    const runId = run.payload.runId as string
    const a1 = c.onPage({
      runId,
      platform: 'x',
      pageIndex: 0,
      origin: 'replay',
      status: 200,
      json: fx('x/curseur-page1.json'),
    })
    expect(a1).toMatchObject({ decision: 'continue', nextCursor: 'Q1VSU09SLXBhZ2Uy' })
    const a2 = c.onPage({
      runId,
      platform: 'x',
      pageIndex: 1,
      origin: 'replay',
      status: 200,
      json: fx('x/curseur-fin.json'),
    })
    expect(a2).toMatchObject({ decision: 'stop', outcome: 'ok' })
    expect(t.repos.sync.getState('x')).toMatchObject({
      backfill_done: 1,
      status: 'ok',
      last_new_count: 20,
      total_synced: 20,
    })
    const s = c.status().sources.find((x) => x.source === 'x')!
    expect(s).toMatchObject({ enabled: true, status: 'ok', browser: 'Firefox', loggedIn: true })
  })

  it('aucun navigateur → no_browser (détail browser_closed) ; non connecté → auth_required sans relance', () => {
    const none = coordinator([])
    none.c.setEnabled('instagram', true)
    expect(none.sent).toEqual([])
    expect(none.c.status().sources.find((x) => x.source === 'instagram')).toMatchObject({
      status: 'no_browser',
      detail: 'browser_closed',
    })
    const out = coordinator([
      { ...firefox, loggedIn: { x: false, instagram: false, cosmos: false } },
    ])
    out.c.setEnabled('x', true)
    expect(out.sent).toEqual([])
    expect(t.repos.sync.getState('x').status).toBe('auth_required')
    t.clock.now += 3_600_000
    out.c.tick()
    expect(out.sent).toEqual([])
  })

  it('3 échecs d’affilée → intervalle doublé ; requête refusée (blocked) → pas de relance automatique', () => {
    const { c, sent } = coordinator([firefox])
    t.repos.sync.patchState('cosmos', { enabled: true, backfillDone: true })
    for (let i = 0; i < 3; i++) {
      t.clock.now += 31 * 60_000
      c.tick()
      const run = sent.filter((s) => s.type === 'sync.run').at(-1)!
      c.onFinished({ runId: run.payload.runId as string, status: 'network' })
    }
    expect(t.repos.sync.getState('cosmos').consecutive_failures).toBe(3)
    const before = sent.length
    t.clock.now += 31 * 60_000
    c.tick()
    expect(sent.length).toBe(before) // 30 min ×2 pas encore écoulées
    t.clock.now += 31 * 60_000
    c.tick()
    expect(sent.length).toBe(before + 1)
    const run = sent.at(-1)!
    c.onFinished({ runId: run.payload.runId as string, status: 'blocked' })
    expect(t.repos.sync.getState('cosmos')).toMatchObject({
      status: 'auth_required',
      last_error: 'blocked',
    })
    t.clock.now += 24 * 3_600_000
    c.tick()
    expect(sent.length).toBe(before + 1)
    c.runNow('cosmos')
    expect(sent.length).toBe(before + 2)
  })

  it('page refusée par le parseur (checkpoint Instagram) → arrêt auth_required', () => {
    const { c, sent } = coordinator([firefox])
    t.repos.sync.patchState('instagram', { enabled: true, backfillDone: true })
    c.runNow('instagram')
    const runId = sent.at(-1)!.payload.runId as string
    const ack = c.onPage({
      runId,
      platform: 'instagram',
      pageIndex: 0,
      origin: 'replay',
      status: 200,
      json: fx('instagram/checkpoint.json'),
    })
    expect(ack).toMatchObject({ decision: 'stop', outcome: 'auth_required' })
    expect(t.repos.sync.getState('instagram').status).toBe('auth_required')
  })

  it('24 h simulées sans option, exécuteur réel de l’extension : aucun onglet créé', async () => {
    const fake = new FakeChrome()
    fake.install()
    fake.cookies.set('ct0', 'c')
    fake.cookies.set('auth_token', 'a')
    fake.cookies.set('csrftoken', 'c')
    fake.cookies.set('sessionid', 's')
    fake.local.set('x.config', {
      api: 'xweb',
      queryId: 'Q',
      operationName: 'bookmarksQuery',
      bearer: 'B',
      providedVariables: {},
      features: {},
      fieldToggles: {},
      source: 'capture',
      appVersion: null,
      bundleUrl: null,
      at: 0,
    })
    fake.local.set('cosmos.me', { id: '8800001' })
    // Jeton Cosmos encore valable (JWT factice non signé, expiration lointaine).
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    fake.local.set('cosmos.token', {
      token: `${b64({ alg: 'none' })}.${b64({ exp: 4_000_000_000, eid: 8800001 })}.sig`,
      exp: 4_000_000_000,
      userId: 8800001,
      at: 0,
    })
    const targets: string[] = []
    const pending: Promise<unknown>[] = []
    // eslint-disable-next-line prefer-const -- affecté après la création du port (références croisées)
    let c!: SyncCoordinator
    const ext = new SyncRunner(
      {
        connected: true,
        post: (type: string, payload?: unknown) => {
          if (type === 'sync.finished') c.onFinished(payload as never)
          return 'id'
        },
        request: (_type: string, payload: unknown) =>
          Promise.resolve({ v: 1, id: 'a', type: 'sync.ack', payload: c.onPage(payload as never) }),
      } as never,
      {
        sleep: () => Promise.resolve(),
        fetchFor: (target, p) => {
          targets.push(target.kind)
          const file =
            p === 'x'
              ? 'x/curseur-fin.json'
              : p === 'instagram'
                ? 'instagram/vide.json'
                : 'cosmos/page-fin.json'
          return Promise.resolve({
            fetch: () => Promise.resolve({ status: 200, headers: {}, json: fx(file), text: null }),
          })
        },
      },
    )
    const port: BridgePort = {
      clients: () => [firefox],
      send: (_id, type, payload) => {
        if (type === 'sync.run') pending.push(ext.run(payload as never))
        return true
      },
      broadcast: () => undefined,
    }
    c = new SyncCoordinator({
      lib: () => lib,
      bridge: () => port,
      prefs: () => DEFAULT_PREFS,
      now: () => t.clock.now,
      emitStatus: () => undefined,
      kickJobs: () => undefined,
      renderCards: () => undefined,
      gatherosConflict: () => false,
      clientsDto: () => [],
      log: { info: () => undefined, warn: () => undefined },
      newId: () => crypto.randomUUID(),
    })
    for (const p of ['x', 'instagram', 'cosmos'] as const)
      t.repos.sync.patchState(p, { enabled: true, backfillDone: true })
    for (let minute = 0; minute < 24 * 60; minute += 5) {
      t.clock.now += 5 * 60_000
      c.tick()
      await Promise.all(pending.splice(0))
    }
    const runs = t.db.prepare('SELECT source, target, status FROM sync_runs').all() as {
      source: string
      target: string | null
      status: string
    }[]
    expect(runs.length).toBeGreaterThanOrEqual(24 * 4 + 24 * 2 * 2 - 3)
    expect(runs.every((r) => r.target === 'background')).toBe(true)
    expect(runs.some((r) => r.target === 'created_tab')).toBe(false)
    expect(new Set(targets)).toEqual(new Set(['background']))
  })
})
