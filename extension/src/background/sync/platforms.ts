/**
 * Clients de sync par plateforme, exécutés depuis l'ARRIÈRE-PLAN (ERRATA §G.2) :
 * - X : GraphQL `Bookmarks` (cookie `ct0` → `x-csrf-token`), `queryId` / jeton public du client web /
 *   `features` résolus dans l'ordre : gabarit capturé → cache `storage.local` → lecture du bundle web ;
 *   auto-réparation des `features` (400 « cannot be null ») et UNE redécouverte sur 400/404/422 ;
 * - Instagram : `feed/saved/posts` (cookie `csrftoken` → `x-csrftoken`), `x-ig-app-id` public ;
 * - Cosmos : GraphQL `GetAllElements` (jeton capturé ou cookie JWT), utilisateur par `me`.
 * Chaque client rend une page brute (le parsing est fait par l'app) ou une issue classée.
 */
import type { BridgePlatform } from '../../../../src/shared/bridge/constants'
import type { SyncOutcome } from '../../../../src/shared/bridge/sync'
import { endpoint } from '../../lib/endpoints'
import { cosmosToken, getLocal, readCookie, removeLocal, setLocal } from '../creds'
import type { FetchFn, FetchResult } from './fetcher'

export type PageOutcome =
  | { kind: 'page'; status: number; headers: Record<string, string>; json: unknown }
  | { kind: 'error'; outcome: SyncOutcome; error: string; resetAt?: number }

export interface PlatformClient {
  platform: BridgePlatform
  fetchPage(cursor: string | null, fetch: FetchFn): Promise<PageOutcome>
}

const err = (outcome: SyncOutcome, error: string, resetAt?: number): PageOutcome => ({
  kind: 'error',
  outcome,
  error,
  ...(resetAt ? { resetAt } : {}),
})

/** Classement commun d'une réponse HTTP (sans le corps propre à la plateforme). */
export function classifyHttp(r: FetchResult): PageOutcome | null {
  if (r.status === 0) return err('network', r.text === 'timeout' ? 'délai dépassé' : 'réseau')
  if (r.status === 429) {
    const reset = Number(r.headers['x-rate-limit-reset'])
    return err('rate_limited', 'limite atteinte', Number.isFinite(reset) ? reset * 1000 : undefined)
  }
  if (r.status === 401 || r.status === 403) return err('blocked', `requête refusée (${r.status})`)
  return null
}

// ---------------------------------------------------------------------------------------- X

export interface XConfig {
  queryId: string
  bearer: string
  features: Record<string, boolean>
  fieldToggles: Record<string, boolean>
  source: 'capture' | 'bundle'
  bundleUrl: string | null
  at: number
}

export const X_CONFIG_KEY = 'x.config'

/** Repère le bundle `main.<hash>.js` dans le HTML de x.com. */
export function findMainBundle(html: string, base: string): string | null {
  const m = /(?:src|href)="([^"]*\/main\.[a-z0-9]+\.js)"/i.exec(html)
  if (!m?.[1]) return null
  try {
    return new URL(m[1], base).href
  } catch {
    return null
  }
}

/** `queryId`, jeton public et `featureSwitches` de l'opération `Bookmarks` dans le bundle web. */
export function parseBundle(js: string): Omit<XConfig, 'source' | 'bundleUrl' | 'at'> | null {
  const q = /queryId:"([\w-]+)",operationName:"Bookmarks"/.exec(js)
  const bearer = /"(AAAAAAAAAAAAAAAAAAAAA[A-Za-z0-9%]{20,})"/.exec(js)
  if (!q?.[1] || !bearer?.[1]) return null
  const meta =
    /operationName:"Bookmarks",operationType:"query",metadata:\{featureSwitches:\[([^\]]*)\],fieldToggles:\[([^\]]*)\]/.exec(
      js,
    )
  const list = (s: string | undefined) =>
    (s ?? '')
      .split(',')
      .map((x) => x.trim().replace(/^"|"$/g, ''))
      .filter(Boolean)
  return {
    queryId: q[1],
    bearer: bearer[1],
    features: Object.fromEntries(list(meta?.[1]).map((f) => [f, true])),
    fieldToggles: Object.fromEntries(list(meta?.[2]).map((f) => [f, false])),
  }
}

/** Noms tirés de « The following features cannot be null: a, b ». */
export function missingFeatures(json: unknown): string[] {
  const errors = (json as { errors?: { message?: string }[] } | null)?.errors ?? []
  for (const e of errors) {
    const m = /features cannot be null:\s*(.+)$/i.exec(e.message ?? '')
    if (m?.[1])
      return m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
  }
  return []
}

export class XClient implements PlatformClient {
  readonly platform = 'x' as const
  private rediscovered = false

  async config(fetch: FetchFn, force = false): Promise<XConfig | null> {
    if (!force) {
      const cached = await getLocal<XConfig>(X_CONFIG_KEY)
      if (cached?.queryId && cached.bearer) return cached
    }
    const home = await fetch(endpoint('x', 'home'), {
      method: 'GET',
      headers: { accept: 'text/html' },
    })
    const bundle = home.text ? findMainBundle(home.text, endpoint('x', 'home')) : null
    if (!bundle) return null
    const js = await fetch(bundle, { method: 'GET', credentials: 'omit' })
    const parsed = js.text ? parseBundle(js.text) : null
    if (!parsed) return null
    const cfg: XConfig = { ...parsed, source: 'bundle', bundleUrl: bundle, at: Date.now() }
    await setLocal(X_CONFIG_KEY, cfg)
    return cfg
  }

  /** Gabarit capturé par le hook lors d'une visite de /i/bookmarks (prioritaire). */
  static async storeTemplate(t: Partial<XConfig>): Promise<void> {
    if (!t.queryId) return
    const prev = await getLocal<XConfig>(X_CONFIG_KEY)
    const bearer = t.bearer ?? prev?.bearer
    if (!bearer) return
    await setLocal(X_CONFIG_KEY, {
      queryId: t.queryId,
      bearer,
      features: t.features ?? prev?.features ?? {},
      fieldToggles: t.fieldToggles ?? prev?.fieldToggles ?? {},
      source: 'capture',
      bundleUrl: prev?.bundleUrl ?? null,
      at: Date.now(),
    } satisfies XConfig)
  }

  buildUrl(cfg: XConfig, cursor: string | null): string {
    const variables = { count: 20, includePromotedContent: true, ...(cursor ? { cursor } : {}) }
    const q = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(cfg.features),
    })
    if (Object.keys(cfg.fieldToggles).length)
      q.set('fieldToggles', JSON.stringify(cfg.fieldToggles))
    return `${endpoint('x', 'graphql')}/${cfg.queryId}/Bookmarks?${q.toString()}`
  }

  async fetchPage(cursor: string | null, fetch: FetchFn): Promise<PageOutcome> {
    const ct0 = await readCookie('x', 'ct0')
    if (!ct0) return err('auth_required', 'session X absente')
    let cfg = await this.config(fetch)
    if (!cfg) return err('api_changed', 'configuration de X introuvable')
    let repaired = false
    for (;;) {
      const tid = await getLocal<string>('x.tid')
      const headers: Record<string, string> = {
        authorization: `Bearer ${cfg.bearer}`,
        'x-csrf-token': ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': 'fr',
        'content-type': 'application/json',
        ...(tid ? { 'x-client-transaction-id': tid } : {}),
      }
      const r = await fetch(this.buildUrl(cfg, cursor), { method: 'GET', headers })
      const missing = r.status === 400 ? missingFeatures(r.json) : []
      if (missing.length && !repaired) {
        repaired = true
        cfg = {
          ...cfg,
          features: { ...cfg.features, ...Object.fromEntries(missing.map((f) => [f, false])) },
        }
        await setLocal(X_CONFIG_KEY, cfg)
        continue
      }
      const http = classifyHttp(r)
      if (http) return http
      const codes = ((r.json as { errors?: { code?: number }[] } | null)?.errors ?? []).map(
        (e) => e.code,
      )
      if (codes.includes(88)) return err('rate_limited', 'limite atteinte')
      if ([400, 404, 422].includes(r.status)) {
        if (this.rediscovered) return err('api_changed', `X a changé son API (${r.status})`)
        this.rediscovered = true
        await removeLocal(X_CONFIG_KEY)
        const fresh = await this.config(fetch, true)
        if (!fresh) return err('api_changed', 'configuration de X introuvable')
        cfg = fresh
        continue
      }
      if (r.status !== 200) return err('api_changed', `réponse ${r.status}`)
      return { kind: 'page', status: r.status, headers: r.headers, json: r.json }
    }
  }
}

// ------------------------------------------------------------------------------- Instagram

export const IG_APP_ID = '936619743392459'
const IG_DEFAULT_ASBD = '129477'

/** Messages d'Instagram qui imposent une action de l'utilisateur (aucune relance). */
export function igAuthProblem(json: unknown): boolean {
  const m = (json as { message?: unknown } | null)?.message
  return typeof m === 'string' && /checkpoint_required|challenge_required|login_required/.test(m)
}

export function igRateLimited(json: unknown): boolean {
  const j = json as { message?: unknown; status?: unknown } | null
  return (
    j?.status === 'fail' && typeof j.message === 'string' && /wait a few minutes/i.test(j.message)
  )
}

/** Code court → `pk` numérique (base 64, alphabet `A–Z a–z 0–9 - _`, 11 premiers caractères). */
export function shortcodeToPk(code: string): string {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let n = 0n
  for (const c of code.slice(0, 11)) {
    const i = alpha.indexOf(c)
    if (i < 0) throw new Error('code court invalide')
    n = n * 64n + BigInt(i)
  }
  return n.toString()
}

export class InstagramClient implements PlatformClient {
  readonly platform = 'instagram' as const

  async headers(): Promise<Record<string, string> | null> {
    const [csrf, session] = await Promise.all([
      readCookie('instagram', 'csrftoken'),
      readCookie('instagram', 'sessionid'),
    ])
    if (!csrf || !session) return null
    const claim = (await getLocal<string>('ig.claim')) ?? '0'
    const asbd = (await getLocal<string>('ig.asbd')) ?? IG_DEFAULT_ASBD
    return {
      'x-ig-app-id': IG_APP_ID,
      'x-csrftoken': csrf,
      'x-requested-with': 'XMLHttpRequest',
      'x-asbd-id': asbd,
      'x-ig-www-claim': claim,
      accept: '*/*',
    }
  }

  private async get(url: string, fetch: FetchFn): Promise<PageOutcome> {
    const headers = await this.headers()
    if (!headers) return err('auth_required', 'session Instagram absente')
    const r = await fetch(url, { method: 'GET', headers })
    const claim = r.headers['x-ig-set-www-claim']
    if (claim) await setLocal('ig.claim', claim)
    if (igAuthProblem(r.json)) return err('auth_required', 'Instagram demande une vérification')
    if (igRateLimited(r.json)) return err('rate_limited', 'Instagram demande d’attendre')
    const http = classifyHttp(r)
    if (http) return http
    if (r.status !== 200) return err('api_changed', `réponse ${r.status}`)
    return { kind: 'page', status: r.status, headers: r.headers, json: r.json }
  }

  fetchPage(cursor: string | null, fetch: FetchFn): Promise<PageOutcome> {
    const base = `${endpoint('instagram', 'api')}/feed/saved/posts/`
    return this.get(cursor ? `${base}?max_id=${encodeURIComponent(cursor)}` : base, fetch)
  }

  fetchMediaInfo(code: string, fetch: FetchFn): Promise<PageOutcome> {
    return this.get(`${endpoint('instagram', 'api')}/media/${shortcodeToPk(code)}/info/`, fetch)
  }
}

// ---------------------------------------------------------------------------------- Cosmos

export const COSMOS_ELEMENTS_QUERY = `query GetAllElements($userId: UserId!, $filters: AllElementsFilters, $order: ElementOrder, $pageCursor: String, $pageSize: Int = 40, $isLoggedIn: Boolean!) {
  allElementsV2(userId: $userId, filters: $filters, order: $order, meta: { pageSize: $pageSize, pageCursor: $pageCursor }) {
    items { id createdAt shareUrl ownerId generatedCaption { text } source { url author } media { url width height } multipleMedia { url width height } video { url thumbnailUrl } mux { mp4Url downloadableUrl } websiteTitle text }
    meta { nextPageCursor count }
  }
}`

export class CosmosClient implements PlatformClient {
  readonly platform = 'cosmos' as const

  private async headers(): Promise<Record<string, string>> {
    const token = await cosmosToken()
    return {
      'content-type': 'application/json',
      accept: 'application/graphql-response+json, application/json',
      'x-client-name': 'cosmos-web',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    }
  }

  private async gql(op: string, body: unknown, fetch: FetchFn): Promise<FetchResult> {
    return fetch(`${endpoint('cosmos', 'graphql')}?q=${op}`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(body),
    })
  }

  async me(fetch: FetchFn): Promise<{ id: string; username?: string } | null> {
    const r = await this.gql(
      'Me',
      { operationName: 'Me', query: 'query Me { me { id username } }', variables: {} },
      fetch,
    )
    const me = (r.json as { data?: { me?: { id?: unknown; username?: unknown } | null } } | null)
      ?.data?.me
    if (!me || typeof me.id !== 'string') return null
    const out = { id: me.id, ...(typeof me.username === 'string' ? { username: me.username } : {}) }
    await setLocal('cosmos.me', out)
    return out
  }

  async fetchPage(cursor: string | null, fetch: FetchFn): Promise<PageOutcome> {
    const me = (await getLocal<{ id: string }>('cosmos.me')) ?? (await this.me(fetch))
    if (!me) return err('auth_required', 'session Cosmos absente')
    const tpl = await getLocal<{ query?: string; order?: unknown }>('cosmos.template')
    const r = await this.gql(
      'GetAllElements',
      {
        operationName: 'GetAllElements',
        query: tpl?.query ?? COSMOS_ELEMENTS_QUERY,
        variables: {
          userId: me.id,
          pageSize: 40,
          pageCursor: cursor,
          isLoggedIn: true,
          ...(tpl?.order ? { order: tpl.order } : {}),
        },
      },
      fetch,
    )
    const errors =
      (r.json as { errors?: { extensions?: { code?: string } }[] } | null)?.errors ?? []
    if (errors.some((e) => /UNAUTHENTICATED|AUTHENTICATION/i.test(e.extensions?.code ?? ''))) {
      await removeLocal('cosmos.me')
      return err('auth_required', 'session Cosmos expirée')
    }
    const http = classifyHttp(r)
    if (http) return http
    if (r.status !== 200) return err('api_changed', `réponse ${r.status}`)
    return { kind: 'page', status: r.status, headers: r.headers, json: r.json }
  }
}

export function clientFor(p: BridgePlatform): PlatformClient {
  return p === 'x' ? new XClient() : p === 'instagram' ? new InstagramClient() : new CosmosClient()
}
