/**
 * Sync en arrière-plan de l'extension (WP-54) : politique de cible (aucun onglet sans option),
 * découverte du `queryId` X sur le bundle, auto-réparation des `features`, en-têtes CSRF, classement
 * des erreurs, boucle de pages pilotée par `sync.ack`, captures sans en-têtes.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FetchFn, FetchResult } from '../../../extension/src/background/sync/fetcher'
import {
  classifyHttp,
  CosmosClient,
  findMainBundle,
  igAuthProblem,
  InstagramClient,
  missingFeatures,
  parseBundle,
  shortcodeToPk,
  XClient,
} from '../../../extension/src/background/sync/platforms'
import { targetsFor } from '../../../extension/src/background/sync/policy'
import { SyncRunner } from '../../../extension/src/background/sync/runner'
import { classify } from '../../../extension/src/lib/classify'
import { FakeChrome } from '../../helpers/fake-chrome'

const FIX = join(import.meta.dirname, '../../fixtures/sync')
const fx = (p: string) => JSON.parse(readFileSync(join(FIX, p), 'utf8')) as unknown
const text = (p: string) => readFileSync(join(FIX, p), 'utf8')

let fake: FakeChrome
beforeEach(() => {
  fake = new FakeChrome()
  fake.install()
})

const ok = (json: unknown, headers: Record<string, string> = {}): FetchResult => ({
  status: 200,
  headers,
  json,
  text: null,
})

describe('politique de cible', () => {
  it('arrière-plan d’abord ; jamais d’onglet créé sans l’option (5 déclencheurs × 3 plateformes)', () => {
    for (const trigger of ['schedule', 'hint', 'manual', 'toggle', 'import'] as const) {
      for (const _p of ['x', 'instagram', 'cosmos']) {
        const t = targetsFor({ trigger, existingTabId: null, allowBackgroundTab: false })
        expect(t).toEqual([{ kind: 'background' }])
        expect(t.some((x) => x.kind === 'created_tab')).toBe(false)
        expect(targetsFor({ trigger, existingTabId: 4, allowBackgroundTab: false })).toEqual([
          { kind: 'background' },
          { kind: 'tab', tabId: 4 },
        ])
        expect(
          targetsFor({ trigger, existingTabId: null, allowBackgroundTab: true }).at(-1),
        ).toEqual({
          kind: 'created_tab',
        })
      }
    }
  })
})

describe('X', () => {
  it('découvre queryId, jeton public et features dans le bundle web', () => {
    const html = text('x/bundle/accueil.html')
    expect(findMainBundle(html, 'https://x.com/')).toBe(
      'https://abs.twimg.com/responsive-web/client-web/main.a1b2c3d4.js',
    )
    const cfg = parseBundle(text('x/bundle/main.js'))
    expect(cfg?.queryId).toBe('BoOkMaRkSqUeRy0001')
    expect(cfg?.bearer).toMatch(/^AAAAAAAAAAAAAAAAAAAAA/)
    expect(Object.keys(cfg?.features ?? {})).toContain('graphql_timeline_v2_bookmark_timeline')
    expect(cfg?.fieldToggles).toEqual({ withAuxiliaryUserLabels: false })
  })

  it('features manquantes extraites du message 400', () => {
    expect(missingFeatures(fx('x/erreur-features.json'))).toEqual([
      'graphql_timeline_v2_bookmark_timeline',
      'rweb_tipjar_consumption_enabled',
    ])
  })

  it('page : csrf = cookie ct0, auto-réparation puis redécouverte unique, puis api_changed', async () => {
    fake.cookies.set('ct0', 'jeton-csrf')
    const calls: { url: string; headers: Record<string, string> }[] = []
    let bookmarksCalls = 0
    const fetch: FetchFn = (url, init) => {
      calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> })
      if (url === 'https://x.com/')
        return Promise.resolve({
          status: 200,
          headers: {},
          json: null,
          text: text('x/bundle/accueil.html'),
        })
      if (url.endsWith('main.a1b2c3d4.js'))
        return Promise.resolve({
          status: 200,
          headers: {},
          json: null,
          text: text('x/bundle/main.js'),
        })
      bookmarksCalls += 1
      if (bookmarksCalls === 1)
        return Promise.resolve({
          status: 400,
          headers: {},
          json: fx('x/erreur-features.json'),
          text: null,
        })
      if (bookmarksCalls === 2) return Promise.resolve(ok(fx('x/curseur-page1.json')))
      return Promise.resolve({ status: 404, headers: {}, json: null, text: '' })
    }
    const c = new XClient()
    const page = await c.fetchPage(null, fetch)
    expect(page.kind).toBe('page')
    const bm = calls.filter((x) => x.url.includes('/Bookmarks?'))
    expect(bm[0]!.headers['x-csrf-token']).toBe('jeton-csrf')
    expect(bm[0]!.headers.authorization).toMatch(/^Bearer AAAA/)
    expect(bm[0]!.url).toContain('/BoOkMaRkSqUeRy0001/Bookmarks?')
    const f2 = JSON.parse(new URL(bm[1]!.url).searchParams.get('features') ?? '{}') as Record<
      string,
      boolean
    >
    expect(f2.rweb_tipjar_consumption_enabled).toBe(false)
    // 404 persistant : une redécouverte puis api_changed (pas de boucle).
    const again = await c.fetchPage('C', fetch)
    expect(again).toMatchObject({ kind: 'error', outcome: 'api_changed' })
  })

  it('sans cookie ct0 : auth_required sans requête', async () => {
    let n = 0
    const r = await new XClient().fetchPage(null, () => {
      n += 1
      return Promise.resolve(ok({}))
    })
    expect(r).toMatchObject({ kind: 'error', outcome: 'auth_required' })
    expect(n).toBe(0)
  })

  it('429 → rate_limited avec x-rate-limit-reset ; 401/403 → blocked ; 0 → network', () => {
    expect(
      classifyHttp({
        status: 429,
        headers: { 'x-rate-limit-reset': '1800000000' },
        json: null,
        text: null,
      }),
    ).toMatchObject({
      outcome: 'rate_limited',
      resetAt: 1_800_000_000_000,
    })
    expect(classifyHttp({ status: 403, headers: {}, json: null, text: null })).toMatchObject({
      outcome: 'blocked',
    })
    expect(classifyHttp({ status: 0, headers: {}, json: null, text: 'network' })).toMatchObject({
      outcome: 'network',
    })
    expect(classifyHttp(ok({}))).toBeNull()
  })
})

describe('Instagram', () => {
  it('en-têtes : x-csrftoken = cookie csrftoken, app id public ; curseur max_id', async () => {
    fake.cookies.set('csrftoken', 'csrf-ig')
    fake.cookies.set('sessionid', 'présent')
    const calls: { url: string; headers: Record<string, string> }[] = []
    const fetch: FetchFn = (url, init) => {
      calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> })
      return Promise.resolve(
        ok(fx('instagram/page-1.json'), { 'x-ig-set-www-claim': 'hmac.claim' }),
      )
    }
    const c = new InstagramClient()
    await c.fetchPage(null, fetch)
    await c.fetchPage('QVFD', fetch)
    expect(calls[0]!.url).toBe('https://www.instagram.com/api/v1/feed/saved/posts/')
    expect(calls[1]!.url).toBe('https://www.instagram.com/api/v1/feed/saved/posts/?max_id=QVFD')
    expect(calls[0]!.headers).toMatchObject({
      'x-ig-app-id': '936619743392459',
      'x-csrftoken': 'csrf-ig',
      'x-ig-www-claim': '0',
    })
    expect(calls[1]!.headers['x-ig-www-claim']).toBe('hmac.claim')
  })

  it('checkpoint / login → auth_required ; « wait a few minutes » → rate_limited', async () => {
    fake.cookies.set('csrftoken', 'c')
    fake.cookies.set('sessionid', 's')
    expect(igAuthProblem(fx('instagram/checkpoint.json'))).toBe(true)
    const c = new InstagramClient()
    expect(
      await c.fetchPage(null, () =>
        Promise.resolve({
          status: 400,
          headers: {},
          json: fx('instagram/checkpoint.json'),
          text: null,
        }),
      ),
    ).toMatchObject({ outcome: 'auth_required' })
    expect(
      await c.fetchPage(null, () => Promise.resolve(ok(fx('instagram/limite.json')))),
    ).toMatchObject({ outcome: 'rate_limited' })
  })

  it('code court → pk (base 64 Instagram)', () => {
    expect(shortcodeToPk('B')).toBe('1')
    expect(shortcodeToPk('BA')).toBe('64')
    expect(() => shortcodeToPk('a!')).toThrow()
  })
})

describe('Cosmos', () => {
  it('me puis GetAllElements avec le jeton capturé ; non connecté → auth_required', async () => {
    fake.local.set('cosmos.token', 'eyJ.abc.def')
    const calls: { url: string; headers: Record<string, string>; body: string }[] = []
    const fetch: FetchFn = (url, init) => {
      calls.push({
        url,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body as string,
      })
      return Promise.resolve(
        ok(url.includes('q=Me') ? fx('cosmos/me.json') : fx('cosmos/page-1.json')),
      )
    }
    const page = await new CosmosClient().fetchPage(null, fetch)
    expect(page.kind).toBe('page')
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.cosmos.so/graphql?q=Me',
      'https://api.cosmos.so/graphql?q=GetAllElements',
    ])
    expect(calls[1]!.headers).toMatchObject({
      authorization: 'Bearer eyJ.abc.def',
      'x-client-name': 'cosmos-web',
    })
    expect(JSON.parse(calls[1]!.body)).toMatchObject({
      variables: { userId: '8800001', pageSize: 40 },
    })
    fake.local.clear()
    const r = await new CosmosClient().fetchPage(null, () =>
      Promise.resolve(ok(fx('cosmos/non-connecte.json'))),
    )
    expect(r).toMatchObject({ outcome: 'auth_required' })
  })
})

describe('captures du hook', () => {
  const ev = (
    url: string,
    method: string,
    headers: Record<string, string>,
    json: unknown = {},
    body: string | null = null,
  ) => ({
    req: { url, method, headers, body },
    status: 200,
    json,
  })

  it('X Bookmarks : gabarit (queryId, features, jeton) vers l’arrière-plan ; capture SANS en-têtes', () => {
    const out = classify(
      ev(
        'https://x.com/i/api/graphql/QiD123/Bookmarks?variables=%7B%7D&features=%7B%22a%22%3Atrue%7D',
        'GET',
        { authorization: 'Bearer PUBLIC', 'x-client-transaction-id': 'tid' },
        fx('x/simple.json'),
      ),
    )
    expect(out[0]).toEqual({
      type: 'content:x-template',
      payload: { queryId: 'QiD123', features: { a: true }, bearer: 'PUBLIC', tid: 'tid' },
    })
    expect(out[1]?.type).toBe('content:capture')
    expect(JSON.stringify(out[1])).not.toMatch(/PUBLIC|tid|authorization/)
  })

  it('enregistrements natifs → indice ; retraits ignorés', () => {
    expect(classify(ev('https://x.com/i/api/graphql/q/CreateBookmark', 'POST', {}))[0]?.type).toBe(
      'content:hint',
    )
    expect(
      classify(ev('https://www.instagram.com/api/v1/web/save/123/save/', 'POST', {}))[0]?.type,
    ).toBe('content:hint')
    expect(
      classify(ev('https://www.instagram.com/api/v1/web/save/123/unsave/', 'POST', {})),
    ).toEqual([])
    expect(
      classify(
        ev('https://www.instagram.com/graphql/query', 'POST', {
          'x-fb-friendly-name': 'usePolarisSaveMediaMutation',
        }),
      )[0]?.type,
    ).toBe('content:hint')
    expect(
      classify(
        ev('https://www.instagram.com/graphql/query', 'POST', {
          'x-fb-friendly-name': 'usePolarisUnsaveMediaMutation',
        }),
      ),
    ).toEqual([])
  })
})

describe('SyncRunner', () => {
  function harness(
    pages: unknown[],
    acks: { decision: 'continue' | 'stop'; nextCursor?: string | null; outcome?: string }[],
  ) {
    const posted: { type: string; payload: Record<string, unknown> }[] = []
    let pi = 0
    const bridge = {
      connected: true,
      post: (type: string, payload?: unknown) => {
        posted.push({ type, payload: payload as Record<string, unknown> })
        return 'id'
      },
      request: (type: string, payload: unknown) => {
        posted.push({ type, payload: payload as Record<string, unknown> })
        const a = acks[pi++] ?? { decision: 'stop' }
        return Promise.resolve({ v: 1, id: 'x', type: 'sync.ack', payload: { runId: 'r1', ...a } })
      },
    }
    const created: string[] = []
    let fi = 0
    const runner = new SyncRunner(bridge as never, {
      sleep: () => Promise.resolve(),
      fetchFor: (t) => {
        created.push(t.kind)
        return Promise.resolve({
          fetch: () => Promise.resolve(ok(pages[Math.min(fi++, pages.length - 1)])),
        })
      },
    })
    return { runner, posted, created }
  }

  beforeEach(() => {
    fake.cookies.set('ct0', 'c')
    fake.cookies.set('auth_token', 'a')
    fake.local.set('x.config', {
      queryId: 'Q',
      bearer: 'B',
      features: {},
      fieldToggles: {},
      source: 'bundle',
      bundleUrl: null,
      at: 0,
    })
  })

  it('suit le curseur de l’app puis s’arrête sur stop ; sync.finished ok, cible arrière-plan', async () => {
    const h = harness(
      [fx('x/curseur-page1.json'), fx('x/curseur-fin.json')],
      [
        { decision: 'continue', nextCursor: 'C2' },
        { decision: 'stop', outcome: 'ok' },
      ],
    )
    const out = await h.runner.run({
      runId: 'r1',
      platform: 'x',
      mode: 'incremental',
      trigger: 'schedule',
      maxPages: 10,
    })
    expect(out).toBe('ok')
    expect(h.posted.filter((m) => m.type === 'sync.page').map((m) => m.payload.pageIndex)).toEqual([
      0, 1,
    ])
    expect(h.posted.at(-1)).toMatchObject({
      type: 'sync.finished',
      payload: { status: 'ok', pages: 2, target: 'background' },
    })
    expect(h.created).toEqual(['background'])
    expect(JSON.stringify(h.posted)).not.toMatch(/x-csrf-token|authorization/)
  })

  it('plafond de pages respecté ; autorisations manquantes → permissions', async () => {
    const h = harness(
      [fx('x/curseur-page1.json')],
      Array.from({ length: 5 }, () => ({ decision: 'continue' as const, nextCursor: 'C' })),
    )
    await h.runner.run({
      runId: 'r1',
      platform: 'x',
      mode: 'backfill',
      trigger: 'toggle',
      maxPages: 3,
    })
    expect(h.posted.filter((m) => m.type === 'sync.page')).toHaveLength(3)
    fake.granted = false
    const h2 = harness([], [])
    expect(
      await h2.runner.run({
        runId: 'r2',
        platform: 'x',
        mode: 'incremental',
        trigger: 'schedule',
        maxPages: 3,
      }),
    ).toBe('permissions')
  })

  it('non connecté → auth_required, aucune requête ; un seul run par plateforme', async () => {
    fake.cookies.delete('auth_token')
    const h = harness([], [])
    expect(
      await h.runner.run({
        runId: 'r1',
        platform: 'x',
        mode: 'incremental',
        trigger: 'schedule',
        maxPages: 3,
      }),
    ).toBe('auth_required')
    expect(h.created).toEqual([])
  })
})
