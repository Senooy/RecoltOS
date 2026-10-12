/**
 * Clients de sync par plateforme, exécutés depuis l'ARRIÈRE-PLAN :
 * - X : client web « x-web » (requêtes Relay persistées) : `GET x.com/i/api/graphql/<id>/bookmarksQuery
 *   ?variables=…` (cookie `ct0` → `x-csrf-token`, jeton public du client web). Configuration résolue
 *   dans l'ordre : gabarit capturé par le hook → cache `storage.local` (revalidé par la version du
 *   client) → découverte dans le code public (`x-discovery.ts`). Réparation des variables manquantes
 *   (422), UNE redécouverte par run sur 404 « Query not found » / 400 / 422. Le client historique
 *   (`responsive-web` `main.<hash>.js`, opération `Bookmarks` + `features`) reste un repli ;
 * - Instagram : `feed/saved/posts` (cookie `csrftoken` → `x-csrftoken`), `x-ig-app-id` public ;
 * - Cosmos : jeton d'accès (JWT) obtenu par `GET www.cosmos.so/api/refresh-token` (cookie httpOnly du
 *   site), puis GraphQL `GetAllElements` sur `api.cosmos.so/graphql` (`authorization: Bearer`).
 * Chaque client rend une page brute (le parsing est fait par l'app) ou une issue classée.
 */
import type { BridgePlatform } from '../../../../src/shared/bridge/constants'
import type { SyncOutcome } from '../../../../src/shared/bridge/sync'
import { endpoint } from '../../lib/endpoints'
import { getLocal, readCookie, removeLocal, setLocal } from '../creds'
import type { FetchFn, FetchResult } from './fetcher'
import { discoverXWeb, isQueryNotFound, missingVariables, providedDefaults } from './x-discovery'
import { xt } from '../../lib/i18n'

export type PageOutcome =
  | { kind: 'page'; status: number; headers: Record<string, string>; json: unknown }
  | { kind: 'error'; outcome: SyncOutcome; error: string; resetAt?: number }

export interface PlatformClient {
  platform: BridgePlatform
  fetchPage(cursor: string | null, fetch: FetchFn): Promise<PageOutcome>
}

type ErrorOutcome = Extract<PageOutcome, { kind: 'error' }>

const err = (outcome: SyncOutcome, error: string, resetAt?: number): ErrorOutcome => ({
  kind: 'error',
  outcome,
  error,
  ...(resetAt ? { resetAt } : {}),
})

/** Classement commun d'une réponse HTTP (sans le corps propre à la plateforme). */
export function classifyHttp(r: FetchResult): PageOutcome | null {
  if (r.status === 0)
    return err('network', r.text === 'timeout' ? xt().syncErrors.timeout : xt().syncErrors.network)
  if (r.status === 429) {
    const reset = Number(r.headers['x-rate-limit-reset'])
    return err(
      'rate_limited',
      xt().syncErrors.rateLimited,
      Number.isFinite(reset) ? reset * 1000 : undefined,
    )
  }
  if (r.status === 401 || r.status === 403) return err('blocked', xt().syncErrors.refused(r.status))
  return null
}

// ---------------------------------------------------------------------------------------- X

export interface XConfig {
  /** `xweb` : requête persistée Relay ; `legacy` : ancien client (`Bookmarks` + `features`). */
  api: 'xweb' | 'legacy'
  queryId: string
  operationName: string
  bearer: string
  /** x-web : « provided variables » Relay ajoutées aux variables. */
  providedVariables: Record<string, boolean>
  /** legacy : `features` / `fieldToggles` de l'opération. */
  features: Record<string, boolean>
  fieldToggles: Record<string, boolean>
  source: 'capture' | 'bundle'
  /** Version du client web (`data-app-version`) au moment de la découverte. */
  appVersion: string | null
  bundleUrl: string | null
  at: number
}

export const X_CONFIG_KEY = 'x.config'
/** Au-delà, la version du client web est revérifiée (une requête) avant d'utiliser le cache. */
export const X_CONFIG_REVALIDATE_MS = 6 * 3_600_000

/** Ancien client : repère le bundle `main.<hash>.js` dans le HTML de x.com. */
export function findMainBundle(html: string, base: string): string | null {
  const m = /(?:src|href)=["']([^"']*\/main\.[a-z0-9]+\.js)["']/i.exec(html)
  if (!m?.[1]) return null
  try {
    return new URL(m[1], base).href
  } catch {
    return null
  }
}

/** Ancien client : `queryId`, jeton public et `featureSwitches` de l'opération `Bookmarks`. */
export function parseBundle(
  js: string,
): Pick<XConfig, 'queryId' | 'bearer' | 'features' | 'fieldToggles'> | null {
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

/** Ancien client : noms tirés de « The following features cannot be null: a, b ». */
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

/** Cache utilisable : forme actuelle (champ `api`), identifiant et jeton présents. */
function validConfig(c: Partial<XConfig> | undefined): c is XConfig {
  return (
    !!c &&
    (c.api === 'xweb' || c.api === 'legacy') &&
    typeof c.queryId === 'string' &&
    typeof c.operationName === 'string' &&
    typeof c.bearer === 'string'
  )
}

/** Signature de requête capturée (valable pour un chemin donné seulement). */
interface CapturedTid {
  path: string
  tid: string
}

export class XClient implements PlatformClient {
  readonly platform = 'x' as const
  private rediscovered = false
  /** Dernière erreur de découverte (message précis remonté à l'app). */
  lastDiscoveryError: string | null = null

  /** Configuration en cache, revalidée par la version du client web, sinon découverte. */
  async config(fetch: FetchFn, force = false): Promise<XConfig | null> {
    if (!force) {
      const cached = await getLocal<Partial<XConfig>>(X_CONFIG_KEY)
      if (validConfig(cached)) {
        if (
          cached.source === 'capture' ||
          !cached.appVersion ||
          Date.now() - cached.at < X_CONFIG_REVALIDATE_MS
        )
          return cached
        const version = await this.homeVersion(fetch)
        if (version === null || version === cached.appVersion) {
          const fresh = { ...cached, at: Date.now() }
          await setLocal(X_CONFIG_KEY, fresh)
          return fresh
        }
      }
    }
    const cfg = (await this.discover(fetch)) ?? (await this.discoverLegacy(fetch))
    if (cfg) {
      this.lastDiscoveryError = null
      await setLocal(X_CONFIG_KEY, cfg)
    }
    return cfg
  }

  private async homeVersion(fetch: FetchFn): Promise<string | null> {
    const r = await fetch(endpoint('x', 'home'), {
      method: 'GET',
      credentials: 'omit',
      headers: { accept: 'text/html' },
    })
    const m = r.text ? /\bdata-app-version=["']([\w.-]{6,80})["']/.exec(r.text) : null
    return m?.[1] ?? null
  }

  private async discover(fetch: FetchFn): Promise<XConfig | null> {
    const res = await discoverXWeb(fetch, {
      homeUrl: endpoint('x', 'home'),
      swUrl: endpoint('x', 'sw'),
    })
    if (!res.ok) {
      this.lastDiscoveryError = res.error
      return null
    }
    const d = res.value
    return {
      api: 'xweb',
      queryId: d.queryId,
      operationName: d.operationName,
      bearer: d.bearer,
      providedVariables: d.providedVariables,
      features: {},
      fieldToggles: {},
      source: 'bundle',
      appVersion: d.appVersion,
      bundleUrl: d.bundleUrl,
      at: Date.now(),
    }
  }

  /** Repli : ancien client `responsive-web` (`main.<hash>.js`), si x.com le sert encore. */
  private async discoverLegacy(fetch: FetchFn): Promise<XConfig | null> {
    const home = await fetch(endpoint('x', 'home'), {
      method: 'GET',
      credentials: 'omit',
      headers: { accept: 'text/html' },
    })
    const bundle = home.text ? findMainBundle(home.text, endpoint('x', 'home')) : null
    if (!bundle) return null
    const js = await fetch(bundle, { method: 'GET', credentials: 'omit' })
    const parsed = js.text ? parseBundle(js.text) : null
    if (!parsed) return null
    return {
      api: 'legacy',
      operationName: 'Bookmarks',
      providedVariables: {},
      ...parsed,
      source: 'bundle',
      appVersion: null,
      bundleUrl: bundle,
      at: Date.now(),
    }
  }

  /** Gabarit capturé par le hook lors d'une visite de /i/bookmarks (prioritaire). */
  static async storeTemplate(t: Partial<XConfig>): Promise<void> {
    if (typeof t.queryId !== 'string' || !/^[\w-]{6,64}$/.test(t.queryId)) return
    const op = typeof t.operationName === 'string' ? t.operationName : 'Bookmarks'
    if (!/^\w{1,80}$/.test(op)) return
    const prev = await getLocal<Partial<XConfig>>(X_CONFIG_KEY)
    const bearer = t.bearer ?? prev?.bearer
    if (!bearer) return
    const api: XConfig['api'] = op === 'Bookmarks' ? 'legacy' : 'xweb'
    await setLocal(X_CONFIG_KEY, {
      api,
      queryId: t.queryId,
      operationName: op,
      bearer,
      providedVariables:
        t.providedVariables ?? (api === 'xweb' ? (prev?.providedVariables ?? {}) : {}),
      features: t.features ?? (api === 'legacy' ? (prev?.features ?? {}) : {}),
      fieldToggles: t.fieldToggles ?? (api === 'legacy' ? (prev?.fieldToggles ?? {}) : {}),
      source: 'capture',
      appVersion: prev?.appVersion ?? null,
      bundleUrl: prev?.bundleUrl ?? null,
      at: Date.now(),
    } satisfies XConfig)
  }

  buildUrl(cfg: XConfig, cursor: string | null): string {
    const base = `${endpoint('x', 'graphql')}/${cfg.queryId}/${cfg.operationName}`
    if (cfg.api === 'xweb') {
      const variables = { count: 20, ...(cursor ? { cursor } : {}), ...cfg.providedVariables }
      return `${base}?${new URLSearchParams({ variables: JSON.stringify(variables) }).toString()}`
    }
    const variables = { count: 20, includePromotedContent: true, ...(cursor ? { cursor } : {}) }
    const q = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(cfg.features),
    })
    if (Object.keys(cfg.fieldToggles).length)
      q.set('fieldToggles', JSON.stringify(cfg.fieldToggles))
    return `${base}?${q.toString()}`
  }

  /** Variables (x-web) ou `features` (ancien client) manquantes, ajoutées au gabarit. */
  private repair(cfg: XConfig, json: unknown): XConfig | null {
    if (cfg.api === 'xweb') {
      const names = missingVariables(json).filter((n) => n.startsWith('__relay_internal__pv__'))
      const fresh = names.filter((n) => !(n in cfg.providedVariables))
      if (!fresh.length) return null
      return { ...cfg, providedVariables: { ...cfg.providedVariables, ...providedDefaults(fresh) } }
    }
    const missing = missingFeatures(json)
    if (!missing.length) return null
    return {
      ...cfg,
      features: { ...cfg.features, ...Object.fromEntries(missing.map((f) => [f, false])) },
    }
  }

  private async rediscover(fetch: FetchFn): Promise<XConfig | null> {
    this.rediscovered = true
    await removeLocal(X_CONFIG_KEY)
    return this.config(fetch, true)
  }

  async fetchPage(cursor: string | null, fetch: FetchFn): Promise<PageOutcome> {
    const ct0 = await readCookie('x', 'ct0')
    if (!ct0) return err('auth_required', 'session X absente')
    let cfg = await this.config(fetch)
    if (!cfg) return err('api_changed', this.lastDiscoveryError ?? 'configuration de X introuvable')
    let repairs = 0
    for (;;) {
      const url = this.buildUrl(cfg, cursor)
      const captured = await getLocal<CapturedTid>('x.tid')
      const tid =
        captured && typeof captured === 'object' && captured.path === new URL(url).pathname
          ? captured.tid
          : null
      const headers: Record<string, string> = {
        authorization: `Bearer ${cfg.bearer}`,
        'x-csrf-token': ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': 'fr',
        'content-type': 'application/json',
        ...(tid ? { 'x-client-transaction-id': tid } : {}),
      }
      const r = await fetch(url, { method: 'GET', headers })
      if ((r.status === 400 || r.status === 422) && repairs < 2) {
        const fixed = this.repair(cfg, r.json)
        if (fixed) {
          repairs += 1
          cfg = fixed
          await setLocal(X_CONFIG_KEY, cfg)
          continue
        }
      }
      const http = classifyHttp(r)
      if (http) return http
      const codes = ((r.json as { errors?: { code?: unknown }[] } | null)?.errors ?? []).map(
        (e) => e.code,
      )
      if (codes.includes(88)) return err('rate_limited', xt().syncErrors.rateLimited)
      if ([400, 404, 422].includes(r.status)) {
        const notFound = r.status === 404 && isQueryNotFound(r.json)
        if (!this.rediscovered) {
          const fresh = await this.rediscover(fetch)
          if (!fresh)
            return err('api_changed', this.lastDiscoveryError ?? 'configuration de X introuvable')
          cfg = fresh
          continue
        }
        if (r.status === 404 && !notFound) {
          // Identifiant reconnu mais requête refusée sans corps : X exige peut-être désormais la
          // signature `x-client-transaction-id` (non reproduite). Repli : capture passive.
          return err('blocked', xt().syncErrors.xBlocked)
        }
        return err(
          'api_changed',
          notFound
            ? xt().syncErrors.xQueryNotFound(cfg.operationName)
            : xt().syncErrors.xApiChanged(r.status),
        )
      }
      if (r.status !== 200) return err('api_changed', xt().syncErrors.response(r.status))
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
    if (!headers) return err('auth_required', xt().syncErrors.igNoSession)
    const r = await fetch(url, { method: 'GET', headers })
    const claim = r.headers['x-ig-set-www-claim']
    if (claim) await setLocal('ig.claim', claim)
    if (igAuthProblem(r.json)) return err('auth_required', xt().syncErrors.igVerification)
    if (igRateLimited(r.json)) return err('rate_limited', xt().syncErrors.igWait)
    const http = classifyHttp(r)
    if (http) return http
    if (r.status !== 200) return err('api_changed', xt().syncErrors.response(r.status))
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

/**
 * Requête des éléments enregistrés, validée contre le schéma public de `api.cosmos.so` le 2026-10-12
 * (le serveur valide le document avant l'authentification). Médias sous fragments (`ElementTile` est
 * une interface : `MediaElementTile`, `WebsiteElementTile`, `ProductElementTile`, `TextElementTile`).
 */
export const COSMOS_ELEMENTS_QUERY = `query GetAllElements($userId: UserId!, $pageCursor: String, $pageSize: Int = 40) {
  allElementsV2(userId: $userId, meta: { pageSize: $pageSize, pageCursor: $pageCursor }) {
    items {
      __typename id createdAt shareUrl ownerId
      generatedCaption { text }
      source { url author { username fullName } }
      ... on MediaElementTile { media { ...RecoltMedia } multipleMedia { ...RecoltMedia } }
      ... on ProductElementTile { media { ...RecoltMedia } }
      ... on WebsiteElementTile { media { ...RecoltMedia } websiteTitle: title }
      ... on TextElementTile { text }
    }
    meta { nextPageCursor count }
  }
}
fragment RecoltMedia on Media {
  __typename url width height
  ... on AnimatedImage { video { url thumbnailUrl } }
  ... on Video { thumbnail { url } mux { playbackUrl mp4Url(quality: HIGH) } }
}`

export const COSMOS_ME_QUERY = 'query Me { me { id username } }'

export const COSMOS_TOKEN_KEY = 'cosmos.token'

/** Jeton d'accès Cosmos (JWT) gardé dans `storage.local`, avec son expiration décodée. */
export interface CosmosToken {
  token: string
  /** Expiration (s, epoch) lue dans le JWT ; `null` si illisible. */
  exp: number | null
  /** Identifiant d'utilisateur (`eid` du JWT) ; `null` si absent. */
  userId: string | number | null
  at: number
}

/** Charge utile d'un JWT, SANS vérification (lecture de `exp` / `eid`). */
export function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const o = JSON.parse(json) as unknown
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function toCosmosToken(token: string, now = Date.now()): CosmosToken {
  const p = jwtPayload(token)
  const exp = typeof p?.exp === 'number' ? p.exp : null
  const eid = p?.eid
  return {
    token,
    exp,
    userId: typeof eid === 'number' || (typeof eid === 'string' && eid) ? eid : null,
    at: now,
  }
}

/** Jeton encore valable au moins 60 s (même marge que le site). */
export function cosmosTokenUsable(t: CosmosToken | null | undefined, now = Date.now()): boolean {
  if (!t?.token) return false
  return t.exp === null || t.exp - now / 1000 > 60
}

/** Jeton stocké (forme actuelle, ou chaîne brute d'une version précédente). */
export async function storedCosmosToken(): Promise<CosmosToken | null> {
  const v = await getLocal<CosmosToken | string>(COSMOS_TOKEN_KEY)
  if (typeof v === 'string') return v ? toCosmosToken(v, 0) : null
  return v && typeof v.token === 'string' ? v : null
}

type GqlError = { message?: string; extensions?: { code?: string } }

function gqlErrors(json: unknown): GqlError[] {
  const e = (json as { errors?: unknown } | null)?.errors
  return Array.isArray(e) ? (e as GqlError[]) : []
}

const isAuthError = (errors: GqlError[]) =>
  errors.some((e) => /UNAUTHENTICATED|AUTHENTICATION/i.test(e.extensions?.code ?? ''))

export class CosmosClient implements PlatformClient {
  readonly platform = 'cosmos' as const

  /**
   * Jeton d'accès : celui du stockage s'il est encore valable, sinon `GET /api/refresh-token` sur
   * www.cosmos.so (le navigateur envoie le cookie httpOnly de la session ; réponse `{accessToken}`).
   */
  async token(fetch: FetchFn, force = false): Promise<CosmosToken | ErrorOutcome> {
    const stored = await storedCosmosToken()
    if (!force && cosmosTokenUsable(stored)) return stored!
    const r = await fetch(endpoint('cosmos', 'refresh'), {
      method: 'GET',
      headers: { accept: 'application/json', 'x-cosmos-refresh-trigger': 'proactive' },
    })
    if (r.status === 0)
      return err(
        'network',
        r.text === 'timeout' ? xt().syncErrors.timeout : xt().syncErrors.network,
      )
    if (r.status === 401 || r.status === 403) {
      await removeLocal(COSMOS_TOKEN_KEY)
      await removeLocal('cosmos.me')
      return err('auth_required', xt().syncErrors.cosmosNoSession)
    }
    const http = classifyHttp(r)
    if (http?.kind === 'error') return http
    const at = (r.json as { accessToken?: unknown } | null)?.accessToken
    if (r.status !== 200 || typeof at !== 'string' || at.split('.').length !== 3) {
      return err('api_changed', xt().syncErrors.cosmosToken(r.status))
    }
    const t = toCosmosToken(at)
    await setLocal(COSMOS_TOKEN_KEY, t)
    return t
  }

  private headers(t: CosmosToken): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/graphql-response+json, application/json',
      'x-client-name': 'cosmos-web',
      authorization: `Bearer ${t.token}`,
    }
  }

  private gql(op: string, query: string, variables: unknown, t: CosmosToken, fetch: FetchFn) {
    return fetch(endpoint('cosmos', 'graphql'), {
      method: 'POST',
      headers: this.headers(t),
      body: JSON.stringify({ operationName: op, query, variables }),
    })
  }

  /** `me` (identifiant numérique ou chaîne, transmis tel quel à `userId`). */
  async me(
    t: CosmosToken,
    fetch: FetchFn,
  ): Promise<{ id: string | number; username?: string } | null> {
    const r = await this.gql('Me', COSMOS_ME_QUERY, {}, t, fetch)
    const me = (r.json as { data?: { me?: { id?: unknown; username?: unknown } | null } } | null)
      ?.data?.me
    if (!me || (typeof me.id !== 'string' && typeof me.id !== 'number')) return null
    const out = { id: me.id, ...(typeof me.username === 'string' ? { username: me.username } : {}) }
    await setLocal('cosmos.me', out)
    return out
  }

  async fetchPage(cursor: string | null, fetch: FetchFn): Promise<PageOutcome> {
    let t = await this.token(fetch)
    if ('kind' in t) return t
    for (let attempt = 0; ; attempt++) {
      const cachedMe = await getLocal<{ id: string | number }>('cosmos.me')
      const userId = t.userId ?? cachedMe?.id ?? (await this.me(t, fetch))?.id ?? null
      if (userId === null) {
        if (attempt === 0) {
          const again = await this.token(fetch, true)
          if ('kind' in again) return again
          t = again
          continue
        }
        return err('auth_required', 'session Cosmos absente : utilisateur introuvable (me)')
      }
      const r = await this.gql(
        'GetAllElements',
        COSMOS_ELEMENTS_QUERY,
        { userId, pageSize: 40, pageCursor: cursor },
        t,
        fetch,
      )
      const errors = gqlErrors(r.json)
      if (isAuthError(errors)) {
        if (attempt === 0) {
          // Jeton expiré ou révoqué : un rafraîchissement, puis une seule nouvelle tentative.
          const again = await this.token(fetch, true)
          if ('kind' in again) return again
          t = again
          continue
        }
        await removeLocal(COSMOS_TOKEN_KEY)
        return err('auth_required', xt().syncErrors.cosmosExpired)
      }
      const http = classifyHttp(r)
      if (http) return http
      if (r.status !== 200) {
        const msg = errors[0]?.message
        return err(
          'api_changed',
          msg
            ? xt().syncErrors.cosmosApiChanged(msg.slice(0, 200))
            : xt().syncErrors.response(r.status),
        )
      }
      return { kind: 'page', status: r.status, headers: r.headers, json: r.json }
    }
  }
}

export function clientFor(p: BridgePlatform): PlatformClient {
  return p === 'x' ? new XClient() : p === 'instagram' ? new InstagramClient() : new CosmosClient()
}
