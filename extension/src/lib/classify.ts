/**
 * Classement des réponses vues par le hook (pur, testé) : gabarit X, indices d'enregistrement natif,
 * captures passives (pages de favoris), jetons Cosmos, en-têtes Instagram. Rien n'est transmis sans
 * passer par ici. Les en-têtes ne partent JAMAIS vers l'app (seulement vers l'arrière-plan).
 */
export interface HookEvent {
  req: { url: string; method: string; headers: Record<string, string>; body: string | null }
  status: number
  claim?: string | null
  json: unknown
}

export type ContentMessage =
  | { type: 'content:x-template'; payload: Record<string, unknown> }
  | { type: 'content:ig-claim'; payload: { claim?: string; asbd?: string } }
  | { type: 'content:cosmos-token'; payload: { token: string } }
  | { type: 'content:hint'; payload: Record<string, never> }
  | { type: 'content:capture'; payload: { op: string; status: number; json: unknown } }

const SAVE_NAME = /save|bookmark|collection/i
const UNSAVE_NAME = /unsave|remove|delete/i

function parseJsonParam(v: string | null): Record<string, boolean> | undefined {
  if (!v) return undefined
  try {
    const o = JSON.parse(v) as unknown
    if (!o || typeof o !== 'object') return undefined
    return Object.fromEntries(
      Object.entries(o as Record<string, unknown>).filter(
        (e): e is [string, boolean] => typeof e[1] === 'boolean',
      ),
    )
  } catch {
    return undefined
  }
}

/** `operationName` du corps JSON d'une requête GraphQL (Cosmos n'utilise pas toujours `?q=`). */
function cosmosOperation(body: string | null): string | null {
  if (!body) return null
  try {
    const op = (JSON.parse(body) as { operationName?: unknown }).operationName
    return typeof op === 'string' && op.length <= 80 ? op : null
  } catch {
    return null
  }
}

/** Nom d'opération GraphQL Instagram (en-tête ou paramètre de corps). */
export function igFriendlyName(e: HookEvent): string | null {
  const h = e.req.headers['x-fb-friendly-name']
  if (h) return h
  const m = /(?:^|&)fb_api_req_friendly_name=([^&]+)/.exec(e.req.body ?? '')
  return m?.[1] ? decodeURIComponent(m[1]) : null
}

export function classify(e: HookEvent): ContentMessage[] {
  const out: ContentMessage[] = []
  let url: URL
  try {
    url = new URL(e.req.url, 'https://x.com')
  } catch {
    return out
  }
  const method = e.req.method.toUpperCase()
  // ---- X (ancien client `Bookmarks` + `features`, client x-web `bookmarksQuery` persisté)
  const xHost = /(^|\.)(x|twitter)\.com$/.test(url.hostname)
  const gql = xHost ? /^(?:\/i\/api)?\/graphql\/([^/]+)\/(\w+)$/.exec(url.pathname) : null
  if (gql) {
    const [, queryId, op] = gql
    if ((op === 'Bookmarks' || op === 'bookmarksQuery') && method === 'GET') {
      const auth = e.req.headers.authorization ?? ''
      const features = parseJsonParam(url.searchParams.get('features'))
      const fieldToggles = parseJsonParam(url.searchParams.get('fieldToggles'))
      const provided =
        op === 'bookmarksQuery'
          ? Object.fromEntries(
              Object.entries(parseJsonParam(url.searchParams.get('variables')) ?? {}).filter(
                ([k]) => k.startsWith('__relay_internal__pv__'),
              ),
            )
          : null
      out.push({
        type: 'content:x-template',
        payload: {
          queryId,
          operationName: op,
          ...(features ? { features } : {}),
          ...(fieldToggles ? { fieldToggles } : {}),
          ...(provided && Object.keys(provided).length ? { providedVariables: provided } : {}),
          ...(/^Bearer\s+\S+$/i.test(auth) ? { bearer: auth.replace(/^Bearer\s+/i, '') } : {}),
          ...(e.req.headers['x-client-transaction-id']
            ? { tid: e.req.headers['x-client-transaction-id'], path: url.pathname }
            : {}),
        },
      })
      if (e.status === 200)
        out.push({
          type: 'content:capture',
          payload: { op: 'Bookmarks', status: e.status, json: e.json },
        })
    }
    if (
      (op === 'CreateBookmark' || op === 'bookmarkButtonAddMutation') &&
      method === 'POST' &&
      e.status === 200
    ) {
      out.push({ type: 'content:hint', payload: {} })
    }
    return out
  }
  // ---- Instagram
  if (url.pathname.startsWith('/api/v1/feed/saved/posts/')) {
    const claim = e.claim ?? e.req.headers['x-ig-www-claim']
    const asbd = e.req.headers['x-asbd-id']
    if (claim || asbd) {
      out.push({
        type: 'content:ig-claim',
        payload: { ...(claim ? { claim } : {}), ...(asbd ? { asbd } : {}) },
      })
    }
    if (e.status === 200) {
      out.push({
        type: 'content:capture',
        payload: { op: 'feed/saved/posts', status: e.status, json: e.json },
      })
    }
    return out
  }
  if (
    /\/api\/v1\/web\/save\/\d+\/save\//.test(url.pathname) &&
    method === 'POST' &&
    e.status === 200
  ) {
    out.push({ type: 'content:hint', payload: {} })
    return out
  }
  if (
    /^\/(graphql\/query|api\/graphql)\/?$/.test(url.pathname) &&
    url.hostname.endsWith('instagram.com')
  ) {
    const name = igFriendlyName(e)
    if (
      name &&
      SAVE_NAME.test(name) &&
      !UNSAVE_NAME.test(name) &&
      method === 'POST' &&
      e.status === 200
    ) {
      out.push({ type: 'content:hint', payload: {} })
    }
    return out
  }
  // ---- Cosmos (jeton de la page en secours ; la requête de l'extension est la sienne)
  if (url.hostname === 'api.cosmos.so' && url.pathname === '/graphql') {
    const op = url.searchParams.get('q') ?? cosmosOperation(e.req.body) ?? ''
    const auth = e.req.headers.authorization ?? ''
    if (/^Bearer\s+\S+$/i.test(auth)) {
      out.push({
        type: 'content:cosmos-token',
        payload: { token: auth.replace(/^Bearer\s+/i, '') },
      })
    }
    if (op === 'GetAllElements' && e.status === 200) {
      out.push({ type: 'content:capture', payload: { op, status: e.status, json: e.json } })
    }
    if (
      /Save|AddElementsToCluster/.test(op) &&
      !/Unsave|Remove|Delete/.test(op) &&
      e.status === 200
    ) {
      out.push({ type: 'content:hint', payload: {} })
    }
  }
  return out
}
