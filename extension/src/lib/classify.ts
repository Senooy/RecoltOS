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
  | { type: 'content:cosmos-token'; payload: { token: string; query?: string; order?: unknown } }
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
  // ---- X
  const gql = /\/i\/api\/graphql\/([^/]+)\/(\w+)$/.exec(url.pathname)
  if (gql) {
    const [, queryId, op] = gql
    if (op === 'Bookmarks' && method === 'GET') {
      const auth = e.req.headers.authorization ?? ''
      out.push({
        type: 'content:x-template',
        payload: {
          queryId,
          ...(parseJsonParam(url.searchParams.get('features'))
            ? { features: parseJsonParam(url.searchParams.get('features')) }
            : {}),
          ...(parseJsonParam(url.searchParams.get('fieldToggles'))
            ? { fieldToggles: parseJsonParam(url.searchParams.get('fieldToggles')) }
            : {}),
          ...(/^Bearer\s+\S+$/i.test(auth) ? { bearer: auth.replace(/^Bearer\s+/i, '') } : {}),
          ...(e.req.headers['x-client-transaction-id']
            ? { tid: e.req.headers['x-client-transaction-id'] }
            : {}),
        },
      })
      if (e.status === 200)
        out.push({
          type: 'content:capture',
          payload: { op: 'Bookmarks', status: e.status, json: e.json },
        })
    }
    if (op === 'CreateBookmark' && method === 'POST' && e.status === 200) {
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
  // ---- Cosmos
  if (url.hostname === 'api.cosmos.so' && url.pathname === '/graphql') {
    const op = url.searchParams.get('q') ?? ''
    const auth = e.req.headers.authorization ?? ''
    if (/^Bearer\s+\S+$/i.test(auth)) {
      let query: string | undefined
      let order: unknown
      if (op === 'GetAllElements' && e.req.body) {
        try {
          const b = JSON.parse(e.req.body) as { query?: unknown; variables?: { order?: unknown } }
          if (typeof b.query === 'string') query = b.query
          order = b.variables?.order
        } catch {
          // corps illisible
        }
      }
      out.push({
        type: 'content:cosmos-token',
        payload: { token: auth.replace(/^Bearer\s+/i, ''), ...(query ? { query, order } : {}) },
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
