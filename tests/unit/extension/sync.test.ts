/**
 * Sync en arrière-plan de l'extension (WP-54, ERRATA §G.3) : politique de cible (aucun onglet sans
 * option), découverte de la configuration X sur le client web x-web (extraits RÉELS minimaux relevés
 * sans cookie le 2026-10-12 : `fixtures/sync/x/xweb/`) et sur l'ancien bundle, réparation des
 * variables / `features`, en-têtes CSRF, jeton Cosmos par `/api/refresh-token`, classement des
 * erreurs, boucle de pages pilotée par `sync.ack`, captures sans en-têtes.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FetchFn, FetchResult } from '../../../extension/src/background/sync/fetcher'
import {
  classifyHttp,
  COSMOS_ELEMENTS_QUERY,
  CosmosClient,
  cosmosTokenUsable,
  findMainBundle,
  igAuthProblem,
  InstagramClient,
  jwtPayload,
  missingFeatures,
  parseBundle,
  shortcodeToPk,
  XClient,
  type XConfig,
} from '../../../extension/src/background/sync/platforms'
import {
  appVersion,
  chunkPriority,
  discoverXWeb,
  findBearer,
  findEntryScripts,
  isQueryNotFound,
  missingVariables,
  parsePersistedOps,
  X_PUBLIC_BEARER,
} from '../../../extension/src/background/sync/x-discovery'
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

const XWEB = 'https://abs.twimg.com/x-web/x-web/'
/**
 * Jeton public des extraits, anonymisé (même forme, valeur factice, préfixe d'en-tête retiré : la garde
 * `fixtures.test.ts` refuse tout jeton dans les fixtures).
 */
const FIXTURE_BEARER =
  'AAAAAAAAAAAAAAAAAAAAAFaKeXwEbPuBlIcToKeN%3DfIxTuReSaNoNyMiSeEs0000000000000000000000000000000000000000'
const PV_LOGGED = '__relay_internal__pv__xclientsfeaturesappviewerisloggedinrelayprovider'
const PV_TRANSLATION =
  '__relay_internal__pv__xclientsfeaturestranslationnoteautotranslationenabledrelayprovider'

/** Faux réseau du client web x-web servi depuis les extraits réels (`x/xweb/`). */
function xwebSite(overrides: Record<string, string | null> = {}): FetchFn & { urls: string[] } {
  const urls: string[] = []
  const serve = (name: string): FetchResult => {
    const body =
      name in overrides
        ? overrides[name]
        : (() => {
            try {
              return text(`x/xweb/${name}`)
            } catch {
              return null
            }
          })()
    return body === null || body === undefined
      ? { status: 404, headers: {}, json: null, text: '' }
      : { status: 200, headers: {}, json: null, text: body }
  }
  const f: FetchFn = (url) => {
    urls.push(url)
    if (url === 'https://x.com/') return Promise.resolve(serve('accueil.html'))
    if (url === 'https://x.com/sw.js') return Promise.resolve(serve('sw.js'))
    if (url.startsWith(XWEB)) return Promise.resolve(serve(url.slice(url.lastIndexOf('/') + 1)))
    return Promise.resolve(serve(''))
  }
  return Object.assign(f, { urls })
}

/** JWT factice (non signé) : `{exp, eid}` lisibles comme ceux de Cosmos. */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.c2lnbmF0dXJl`
}

const XWEB_CONFIG: XConfig = {
  api: 'xweb',
  queryId: 'S0GjncHMwHQK1YOfxslymQ',
  operationName: 'bookmarksQuery',
  bearer: 'B',
  providedVariables: { [PV_LOGGED]: true },
  features: {},
  fieldToggles: {},
  source: 'bundle',
  appVersion: 'v1',
  bundleUrl: null,
  at: Date.now(),
}

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

  it('ancien client (repli) : csrf = cookie ct0, auto-réparation des features, puis redécouverte unique', async () => {
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
      if (!url.includes('/i/api/graphql/'))
        return Promise.resolve({ status: 404, headers: {}, json: null, text: '' })
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
    // 404 persistant : une redécouverte puis échec classé (pas de boucle).
    const again = await c.fetchPage('C', fetch)
    expect(again.kind).toBe('error')
    expect(calls.filter((x) => x.url.includes('/Bookmarks?')).length).toBeLessThanOrEqual(5)
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

describe('X — client x-web (extraits réels)', () => {
  it('HTML : version du client et script d’entrée module, quel que soit l’ordre des attributs', () => {
    const html = text('x/xweb/accueil.html')
    expect(appVersion(html)).toBe('3baf5ddf7cf0fe60635f3681052c1f9cbd982a38')
    expect(findEntryScripts(html, 'https://x.com/')).toEqual([
      `${XWEB}entry-client-logged-out-Cyu8aWGq.js`,
    ])
    expect(
      findEntryScripts(
        '<script nonce="n" src="https://abs.twimg.com/x-web/x-web/entry-client-logged-in-Zz9.js" type="module" async></script>',
        'https://x.com/',
      ),
    ).toEqual([`${XWEB}entry-client-logged-in-Zz9.js`])
    // L'ancien bundle n'est pas une entrée x-web.
    expect(findEntryScripts(text('x/bundle/accueil.html'), 'https://x.com/')).toEqual([])
  })

  it('params Relay persistés : nom, id, provided variables ; mutation et AST ignorés', () => {
    const ops = parsePersistedOps(text('x/xweb/bookmarks-CXtFauZD.js'))
    expect(ops).toEqual([
      {
        id: 'S0GjncHMwHQK1YOfxslymQ',
        name: 'bookmarksQuery',
        providedVariables: [PV_LOGGED, PV_TRANSLATION],
      },
    ])
    expect(parsePersistedOps(text('x/xweb/bookmarks-folder-modals-Czv1HVNa.js'))).toEqual([])
    expect(parsePersistedOps(text('x/xweb/bookmark-folders-BF_gvkt4.js'))[0]?.name).toBe(
      'bookmarkFoldersQuery',
    )
    // Guillemets ordinaires et ordre des clés différent.
    expect(
      parsePersistedOps(
        'x={params:{"name":"bookmarksQuery","operationKind":"query","id":"AbCdEf123456","metadata":{},"text":null}}',
      ),
    ).toEqual([{ id: 'AbCdEf123456', name: 'bookmarksQuery', providedVariables: [] }])
  })

  it('jeton public, priorités de parcours, erreurs de la passerelle', () => {
    expect(findBearer(text('x/xweb/sw.js'))).toBe(FIXTURE_BEARER)
    expect(findBearer(text('x/xweb/guest-token-RWAebql4.js'))).toBe(FIXTURE_BEARER)
    // Forme réelle : `n.set(\`Authorization\`,\`Bearer AAAA…\`)`.
    expect(findBearer(`n.set(\`Authorization\`,\`Bearer ${X_PUBLIC_BEARER}\`)`)).toBe(
      X_PUBLIC_BEARER,
    )
    expect(chunkPriority(`${XWEB}assets/bookmarks-CXtFauZD.js`)).toBe(0)
    expect(chunkPriority(`${XWEB}assets/history-DtLSeQQ0.js`)).toBe(1)
    expect(chunkPriority(`${XWEB}assets/icon-bookmarks-DM1mZAb_.js`)).toBeNull()
    expect(chunkPriority(`${XWEB}assets/sentry-filter-BY-NuQPN.js`)).toBe(2)
    // Réponses relevées sur la passerelle (requête invitée publique).
    expect(
      missingVariables({
        errors: [
          {
            code: 'GRAPHQL_VALIDATION_FAILED',
            extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
            message: 'must be defined',
            path: ['variable', PV_LOGGED],
          },
        ],
      }),
    ).toEqual([PV_LOGGED])
    expect(isQueryNotFound({ message: 'Query not found' })).toBe(true)
    expect(isQueryNotFound(null)).toBe(false)
  })

  it('découverte : accueil → entrée → arbre de routes → history → bookmarks, sans cookie', async () => {
    const site = xwebSite()
    const calls: RequestInit[] = []
    const fetch: FetchFn = (url, init) => {
      calls.push(init)
      return site(url, init)
    }
    const r = await discoverXWeb(fetch, { homeUrl: 'https://x.com/', swUrl: 'https://x.com/sw.js' })
    expect(r).toMatchObject({
      ok: true,
      value: {
        queryId: 'S0GjncHMwHQK1YOfxslymQ',
        operationName: 'bookmarksQuery',
        providedVariables: { [PV_LOGGED]: true, [PV_TRANSLATION]: false },
        bearer: FIXTURE_BEARER,
        bearerSource: 'bundle',
        appVersion: '3baf5ddf7cf0fe60635f3681052c1f9cbd982a38',
        bundleUrl: `${XWEB}assets/bookmarks-CXtFauZD.js`,
      },
    })
    expect(calls.every((c) => c.credentials === 'omit')).toBe(true)
    expect(site.urls).toContain(`${XWEB}assets/history-DtLSeQQ0.js`)
    expect(site.urls.some((u) => u.includes('icon-'))).toBe(false)
    expect(site.urls.length).toBeLessThan(20)
  })

  it('découverte : jeton lu dans sw.js, sinon constante ; erreurs précises à chaque étape', async () => {
    const opts = { homeUrl: 'https://x.com/', swUrl: 'https://x.com/sw.js' }
    const noGuest = await discoverXWeb(xwebSite({ 'guest-token-RWAebql4.js': null }), opts)
    expect(noGuest).toMatchObject({ ok: true, value: { bearerSource: 'sw' } })
    const none = await discoverXWeb(
      xwebSite({ 'guest-token-RWAebql4.js': null, 'sw.js': null }),
      opts,
    )
    expect(none).toMatchObject({
      ok: true,
      value: { bearer: X_PUBLIC_BEARER, bearerSource: 'constant' },
    })
    const noEntry = await discoverXWeb(xwebSite({ 'accueil.html': '<html></html>' }), opts)
    expect(noEntry).toEqual({
      ok: false,
      error: expect.stringMatching(/aucun script x-web \(entry-client\)/) as unknown,
    })
    const noOp = await discoverXWeb(xwebSite({ 'bookmarks-CXtFauZD.js': 'export{}' }), opts)
    expect(noOp).toEqual({
      ok: false,
      error: expect.stringMatching(
        /opération GraphQL « bookmarksQuery » absente des \d+ scripts/,
      ) as unknown,
    })
    const down = await discoverXWeb(
      () => Promise.resolve({ status: 0, headers: {}, json: null, text: 'network' }),
      opts,
    )
    expect(down).toMatchObject({
      ok: false,
      error: expect.stringMatching(/injoignable/) as unknown,
    })
  })

  it('page : découverte, GET persisté (variables + provided variables), réparation 422, en-têtes', async () => {
    fake.cookies.set('ct0', 'jeton-csrf')
    const site = xwebSite()
    const gql: { url: string; headers: Record<string, string> }[] = []
    const fetch: FetchFn = (url, init) => {
      if (url.startsWith('https://x.com/i/api/graphql/')) {
        gql.push({ url, headers: (init.headers ?? {}) as Record<string, string> })
        const vars = JSON.parse(new URL(url).searchParams.get('variables') ?? '{}') as Record<
          string,
          unknown
        >
        if (!('__relay_internal__pv__nouvelle' in vars))
          return Promise.resolve({
            status: 422,
            headers: {},
            json: {
              errors: [
                {
                  code: 'GRAPHQL_VALIDATION_FAILED',
                  message: 'must be defined',
                  path: ['variable', '__relay_internal__pv__nouvelle'],
                },
              ],
            },
            text: null,
          })
        return Promise.resolve(ok(fx('x/xweb-page-1.json')))
      }
      return site(url, init)
    }
    const page = await new XClient().fetchPage('CURSEUR', fetch)
    expect(page.kind).toBe('page')
    expect(gql).toHaveLength(2)
    const u = new URL(gql[1]!.url)
    expect(u.pathname).toBe('/i/api/graphql/S0GjncHMwHQK1YOfxslymQ/bookmarksQuery')
    expect(u.searchParams.get('features')).toBeNull()
    expect(JSON.parse(u.searchParams.get('variables')!)).toEqual({
      count: 20,
      cursor: 'CURSEUR',
      [PV_LOGGED]: true,
      [PV_TRANSLATION]: false,
      __relay_internal__pv__nouvelle: false,
    })
    expect(gql[1]!.headers).toMatchObject({
      authorization: `Bearer ${FIXTURE_BEARER}`,
      'x-csrf-token': 'jeton-csrf',
      'x-twitter-auth-type': 'OAuth2Session',
    })
    expect(gql[1]!.headers['x-client-transaction-id']).toBeUndefined()
    // Configuration réparée gardée en cache.
    const cached = fake.local.get('x.config') as XConfig
    expect(cached.providedVariables.__relay_internal__pv__nouvelle).toBe(false)
  })

  it('« Query not found » → une redécouverte ; 404 sans corps persistant → blocked (signature)', async () => {
    fake.cookies.set('ct0', 'c')
    fake.local.set('x.config', { ...XWEB_CONFIG, queryId: 'PeRiMe000000' })
    const site = xwebSite()
    const ids: string[] = []
    const notFound: FetchFn = (url, init) => {
      if (url.startsWith('https://x.com/i/api/graphql/')) {
        ids.push(new URL(url).pathname.split('/')[4]!)
        return Promise.resolve({
          status: 404,
          headers: {},
          json: { message: 'Query not found' },
          text: null,
        })
      }
      return site(url, init)
    }
    const r = await new XClient().fetchPage(null, notFound)
    expect(ids).toEqual(['PeRiMe000000', 'S0GjncHMwHQK1YOfxslymQ'])
    expect(r).toMatchObject({ kind: 'error', outcome: 'api_changed' })
    expect((r as { error: string }).error).toMatch(/Query not found/)

    const empty: FetchFn = (url, init) =>
      url.startsWith('https://x.com/i/api/graphql/')
        ? Promise.resolve({ status: 404, headers: {}, json: null, text: '' })
        : site(url, init)
    const b = await new XClient().fetchPage(null, empty)
    expect(b).toMatchObject({ kind: 'error', outcome: 'blocked' })
    expect((b as { error: string }).error).toMatch(/x-client-transaction-id/)
  })

  it('cache : revalidé par la version du client (une requête), sinon redécouvert', async () => {
    fake.cookies.set('ct0', 'c')
    const old = Date.now() - 7 * 3_600_000
    fake.local.set('x.config', {
      ...XWEB_CONFIG,
      appVersion: '3baf5ddf7cf0fe60635f3681052c1f9cbd982a38',
      at: old,
    })
    const site = xwebSite()
    const fetch: FetchFn = (url, init) =>
      url.startsWith('https://x.com/i/api/graphql/')
        ? Promise.resolve(ok(fx('x/xweb-page-1.json')))
        : site(url, init)
    expect((await new XClient().fetchPage(null, fetch)).kind).toBe('page')
    expect(site.urls).toEqual(['https://x.com/'])
    expect((fake.local.get('x.config') as XConfig).at).toBeGreaterThan(old)
    // Nouvelle version du client : redécouverte complète.
    fake.local.set('x.config', {
      ...XWEB_CONFIG,
      queryId: 'AnCiEn000000',
      appVersion: 'ancienne',
      at: old,
    })
    const site2 = xwebSite()
    const ids: string[] = []
    await new XClient().fetchPage(null, (url, init) => {
      if (url.startsWith('https://x.com/i/api/graphql/')) {
        ids.push(new URL(url).pathname.split('/')[4]!)
        return Promise.resolve(ok(fx('x/xweb-page-1.json')))
      }
      return site2(url, init)
    })
    expect(ids).toEqual(['S0GjncHMwHQK1YOfxslymQ'])
    // Ancien format de cache (sans `api`) : ignoré.
    fake.local.set('x.config', {
      queryId: 'Q',
      bearer: 'B',
      features: {},
      fieldToggles: {},
      source: 'bundle',
      bundleUrl: null,
      at: Date.now(),
    })
    const site3 = xwebSite()
    await new XClient().fetchPage(null, (url, init) =>
      url.startsWith('https://x.com/i/api/graphql/')
        ? Promise.resolve(ok(fx('x/xweb-page-1.json')))
        : site3(url, init),
    )
    expect(site3.urls.some((u) => u.endsWith('bookmarks-CXtFauZD.js'))).toBe(true)
  })

  it('échec de découverte : message précis remonté (api_changed)', async () => {
    fake.cookies.set('ct0', 'c')
    const r = await new XClient().fetchPage(null, xwebSite({ 'accueil.html': '<html></html>' }))
    expect(r).toMatchObject({ kind: 'error', outcome: 'api_changed' })
    expect((r as { error: string }).error).toMatch(/aucun script x-web/)
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
  const NOW_S = Math.floor(Date.now() / 1000)

  it('jeton par /api/refresh-token (cookie du site), puis GetAllElements valide, userId du JWT', async () => {
    const jwt = fakeJwt({ exp: NOW_S + 3600, iat: NOW_S, eid: 8800001 })
    const calls: { url: string; init: RequestInit }[] = []
    const fetch: FetchFn = (url, init) => {
      calls.push({ url, init })
      if (url === 'https://www.cosmos.so/api/refresh-token')
        return Promise.resolve(ok({ accessToken: jwt }))
      return Promise.resolve(ok(fx('cosmos/schema-2026.json')))
    }
    const page = await new CosmosClient().fetchPage('CURSEUR', fetch)
    expect(page.kind).toBe('page')
    expect(calls.map((c) => c.url)).toEqual([
      'https://www.cosmos.so/api/refresh-token',
      'https://api.cosmos.so/graphql',
    ])
    expect(calls[0]!.init.method).toBe('GET')
    expect(calls[0]!.init.headers).toMatchObject({ 'x-cosmos-refresh-trigger': 'proactive' })
    expect(calls[1]!.init.headers).toMatchObject({
      authorization: `Bearer ${jwt}`,
      'x-client-name': 'cosmos-web',
    })
    const body = JSON.parse(calls[1]!.init.body as string) as Record<string, unknown>
    expect(body).toEqual({
      operationName: 'GetAllElements',
      query: COSMOS_ELEMENTS_QUERY,
      variables: { userId: 8800001, pageSize: 40, pageCursor: 'CURSEUR' },
    })
    // Le jeton est gardé (expiration décodée) et resservi sans nouveau rafraîchissement.
    expect(fake.local.get('cosmos.token')).toMatchObject({ token: jwt, exp: NOW_S + 3600 })
    calls.length = 0
    await new CosmosClient().fetchPage(null, fetch)
    expect(calls.map((c) => c.url)).toEqual(['https://api.cosmos.so/graphql'])
  })

  it('refresh 401 (non connecté) → auth_required sans requête GraphQL', async () => {
    const urls: string[] = []
    const r = await new CosmosClient().fetchPage(null, (url) => {
      urls.push(url)
      return Promise.resolve({
        status: 401,
        headers: {},
        json: { message: 'Token refresh failed' },
        text: null,
      })
    })
    expect(r).toMatchObject({ kind: 'error', outcome: 'auth_required' })
    expect((r as { error: string }).error).toMatch(/connecte-toi sur cosmos\.so/)
    expect(urls).toEqual(['https://www.cosmos.so/api/refresh-token'])
  })

  it('AUTHENTICATION → un rafraîchissement forcé puis nouvelle tentative ; sans eid → me (id numérique)', async () => {
    fake.local.set('cosmos.token', {
      token: fakeJwt({ exp: NOW_S + 3600 }),
      exp: NOW_S + 3600,
      userId: null,
      at: 0,
    })
    const fresh = fakeJwt({ exp: NOW_S + 7200 })
    let elements = 0
    const urls: string[] = []
    const fetch: FetchFn = (url, init) => {
      urls.push(url)
      if (url.endsWith('/api/refresh-token')) return Promise.resolve(ok({ accessToken: fresh }))
      const op = (JSON.parse(init.body as string) as { operationName: string }).operationName
      if (op === 'Me')
        return Promise.resolve(ok({ data: { me: { id: 8800001, username: 'compte.test' } } }))
      elements += 1
      return Promise.resolve(
        elements === 1
          ? { status: 401, headers: {}, json: fx('cosmos/non-connecte.json'), text: null }
          : ok(fx('cosmos/page-1.json')),
      )
    }
    const page = await new CosmosClient().fetchPage(null, fetch)
    expect(page.kind).toBe('page')
    expect(urls.filter((u) => u.endsWith('/api/refresh-token'))).toHaveLength(1)
    expect(fake.local.get('cosmos.me')).toEqual({ id: 8800001, username: 'compte.test' })
    expect((fake.local.get('cosmos.token') as { token: string }).token).toBe(fresh)
  })

  it('JWT : expiration et marge de 60 s', () => {
    const t = fakeJwt({ exp: 2_000_000_000, eid: '42' })
    expect(jwtPayload(t)).toMatchObject({ exp: 2_000_000_000, eid: '42' })
    expect(jwtPayload('pas-un-jwt')).toBeNull()
    expect(
      cosmosTokenUsable({ token: t, exp: 2_000_000_000, userId: '42', at: 0 }, 1_999_999_000_000),
    ).toBe(true)
    expect(
      cosmosTokenUsable({ token: t, exp: 2_000_000_000, userId: '42', at: 0 }, 1_999_999_950_000),
    ).toBe(false)
    expect(cosmosTokenUsable(null)).toBe(false)
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
      payload: {
        queryId: 'QiD123',
        operationName: 'Bookmarks',
        features: { a: true },
        bearer: 'PUBLIC',
        tid: 'tid',
        path: '/i/api/graphql/QiD123/Bookmarks',
      },
    })
    expect(out[1]?.type).toBe('content:capture')
    expect(JSON.stringify(out[1])).not.toMatch(/PUBLIC|tid|authorization/)
  })

  it('X x-web : bookmarksQuery sur api.x.com → gabarit (provided variables) et capture ; ajout natif → indice', () => {
    const vars = encodeURIComponent(
      JSON.stringify({ count: 20, [PV_LOGGED]: true, [PV_TRANSLATION]: false }),
    )
    const out = classify(
      ev(
        `https://api.x.com/graphql/S0GjncHMwHQK1YOfxslymQ/bookmarksQuery?variables=${vars}`,
        'GET',
        { authorization: 'Bearer PUBLIC', 'x-client-transaction-id': 'signature' },
        fx('x/xweb-page-1.json'),
      ),
    )
    expect(out[0]).toEqual({
      type: 'content:x-template',
      payload: {
        queryId: 'S0GjncHMwHQK1YOfxslymQ',
        operationName: 'bookmarksQuery',
        providedVariables: { [PV_LOGGED]: true, [PV_TRANSLATION]: false },
        bearer: 'PUBLIC',
        tid: 'signature',
        path: '/graphql/S0GjncHMwHQK1YOfxslymQ/bookmarksQuery',
      },
    })
    expect(out[1]).toMatchObject({ type: 'content:capture', payload: { op: 'Bookmarks' } })
    expect(JSON.stringify(out[1])).not.toMatch(/PUBLIC|signature/)
    expect(
      classify(
        ev(
          'https://api.x.com/graphql/d5cUgGn90np33i-G4PE12w/bookmarkButtonAddMutation',
          'POST',
          {},
        ),
      )[0]?.type,
    ).toBe('content:hint')
    // Une autre requête GraphQL d'un autre site n'est jamais lue comme X.
    expect(classify(ev('https://example.com/graphql/abc/bookmarksQuery', 'GET', {}))).toEqual([])
  })

  it('Cosmos : jeton de la page transmis à l’arrière-plan, capture de GetAllElements', () => {
    const out = classify({
      req: {
        url: 'https://api.cosmos.so/graphql',
        method: 'POST',
        headers: { authorization: 'Bearer eyJ.abc.def' },
        body: JSON.stringify({
          operationName: 'GetAllElements',
          query: 'query GetAllElements {…}',
        }),
      },
      status: 200,
      json: fx('cosmos/schema-2026.json'),
    })
    expect(out[0]).toEqual({ type: 'content:cosmos-token', payload: { token: 'eyJ.abc.def' } })
    expect(out[1]).toMatchObject({ type: 'content:capture', payload: { op: 'GetAllElements' } })
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
    fake.local.set('x.config', { ...XWEB_CONFIG, source: 'capture' })
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
