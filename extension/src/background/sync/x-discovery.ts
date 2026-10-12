/**
 * Découverte de la configuration X depuis le client web PUBLIC (relevé du 2026-10-12).
 *
 * Depuis l'automne 2026, x.com sert un nouveau client « x-web » (TanStack Router + Relay, modules ES
 * sous `abs.twimg.com/x-web/x-web/`) à la place de `responsive-web/client-web/main.<hash>.js`. Les
 * opérations GraphQL sont des requêtes Relay PERSISTÉES : `GET <passerelle>/<id>/<nom>?variables=…`,
 * sans `features` ; les « provided variables » Relay (`__relay_internal__pv__…`) font partie des
 * variables. Chaîne observée pour les favoris (aucun cookie, HTML déconnecté) :
 *   x.com/ → `<script type="module" src=…/entry-client-*.js>` → arbre de routes (import statique de
 *   l'entrée) → route `history-*.js` (`__vite__mapDeps`) → `bookmarks-*.js`, qui contient
 *   `params:{id:"…",metadata:{},name:"bookmarksQuery",operationKind:"query",…,providedVariables:{…}}`.
 * Jeton public du client web : constante `Bearer AAAA…` présente dans `x.com/sw.js` et dans un chunk.
 *
 * Fonctions pures (testées sur des extraits réels minimaux) + `discoverXWeb`, parcours borné et
 * priorisé du graphe de modules (noms `bookmarks-*` puis `history-*` d'abord ; les autres seulement
 * depuis l'entrée et un niveau en dessous), avec un message d'erreur précis à chaque étape.
 */
import { xt } from '../../lib/i18n'
import type { FetchFn } from './fetcher'

/** Jeton public du client web X (stable depuis des années ; repli si la lecture échoue). */
export const X_PUBLIC_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

export const XWEB_BOOKMARKS_OP = 'bookmarksQuery'

/** Opération persistée trouvée dans un chunk. */
export interface PersistedOp {
  id: string
  name: string
  /** Noms des « provided variables » Relay attendues par l'opération. */
  providedVariables: string[]
}

export interface XWebDiscovery {
  queryId: string
  operationName: string
  providedVariables: Record<string, boolean>
  bearer: string
  bearerSource: 'bundle' | 'sw' | 'constant'
  appVersion: string | null
  entryUrl: string
  /** Chunk où l'opération a été trouvée. */
  bundleUrl: string
  /** Nombre de scripts lus (diagnostic). */
  scripts: number
}

export type DiscoveryResult = { ok: true; value: XWebDiscovery } | { ok: false; error: string }

/** `data-app-version` de `<html>` ou `<meta name="app-version">` (clé de cache). */
export function appVersion(html: string): string | null {
  const m =
    /\bdata-app-version=["']([\w.-]{6,80})["']/.exec(html) ??
    /<meta[^>]*\bname=["']app-version["'][^>]*\bcontent=["']([\w.-]{6,80})["']/i.exec(html)
  return m?.[1] ?? null
}

/**
 * Scripts d'entrée x-web du HTML (`<script … src=…>` dont le chemin contient `/x-web/` ou
 * `entry-client`), ordre d'apparition, sans doublon. Attributs dans n'importe quel ordre.
 */
export function findEntryScripts(html: string, base: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc=["']([^"']+\.m?js)["'][^>]*>/gi)) {
    const src = m[1]!
    if (!/\/x-web\/|entry-client/i.test(src)) continue
    try {
      const u = new URL(src, base).href
      if (!out.includes(u)) out.push(u)
    } catch {
      // URL illisible
    }
  }
  // Les entrées d'abord (`entry-client*`), puis les autres modules x-web.
  return out.sort((a, b) => Number(!/entry-client/.test(a)) - Number(!/entry-client/.test(b)))
}

/** Jeton public `AAAA…` (avec ou sans `Bearer `), entre guillemets, apostrophes ou accents graves. */
export function findBearer(js: string): string | null {
  const m = /["'`](?:Bearer\s+)?(AAAAAAAAAAAAAAAAAAAAA[A-Za-z0-9%]{30,})["'`]/.exec(js)
  return m?.[1] ?? null
}

/**
 * Références de chunks `./x.js` / `./assets/x.js` / `../x.js` (imports statiques, `import()`,
 * listes `__vite__mapDeps`), résolues par rapport à l'URL du fichier.
 */
export function chunkRefs(js: string, fileUrl: string): string[] {
  const out = new Set<string>()
  for (const m of js.matchAll(/["'`](\.{1,2}\/[\w./-]+?\.m?js)["'`]/g)) {
    try {
      out.add(new URL(m[1]!, fileUrl).href)
    } catch {
      // référence illisible
    }
  }
  return [...out]
}

/** Valeur d'une clé dans le corps d'un objet littéral (`id:"…"`, `id:\`…\``, `"id":"…"`). */
function literal(body: string, key: string): string | null {
  const m = new RegExp(`(?:^|[,{\\s])["']?${key}["']?\\s*:\\s*["'\`]([^"'\`]{1,200})["'\`]`).exec(
    body,
  )
  return m?.[1] ?? null
}

/**
 * `params:{id,…,name,operationKind,…,providedVariables:{…}}` d'une opération Relay persistée, quel
 * que soit l'ordre des clés et le type de guillemets. Un seul niveau d'imbrication (`metadata:{}`,
 * `providedVariables:{…}`) est attendu dans `params`.
 */
export function parsePersistedOps(js: string): PersistedOp[] {
  const out: PersistedOp[] = []
  for (const m of js.matchAll(/["']?params["']?\s*:\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
    const body = m[1]!
    const id = literal(body, 'id')
    const name = literal(body, 'name')
    if (!id || !name || !/^[\w-]{6,64}$/.test(id) || !/^\w{1,80}$/.test(name)) continue
    const kind = literal(body, 'operationKind')
    if (kind !== null && kind !== 'query') continue
    const pv = /["']?providedVariables["']?\s*:\s*\{([^{}]*)\}/.exec(body)
    const providedVariables = pv
      ? [...pv[1]!.matchAll(/["']?(__relay_internal__pv__\w+)["']?\s*:/g)].map((x) => x[1]!)
      : []
    out.push({ id, name, providedVariables })
  }
  return out
}

/** Valeur par défaut d'une « provided variable » : « connecté » vrai, le reste faux. */
export function providedDefaults(names: string[]): Record<string, boolean> {
  return Object.fromEntries(names.map((n) => [n, /isloggedin/i.test(n)]))
}

/** Variables manquantes signalées par la passerelle (`422`, `path: ["variable", nom]`). */
export function missingVariables(json: unknown): string[] {
  const errors = (json as { errors?: { path?: unknown; message?: unknown }[] } | null)?.errors
  if (!Array.isArray(errors)) return []
  const out: string[] = []
  for (const e of errors) {
    const p = Array.isArray(e?.path) ? (e.path as unknown[]) : []
    if (p[0] === 'variable' && typeof p[1] === 'string' && /^\w{1,128}$/.test(p[1])) {
      out.push(p[1])
      continue
    }
    const m =
      typeof e?.message === 'string'
        ? /Variable "\$(\w{1,128})"[^.]*(?:not provided|must be defined)/i.exec(e.message)
        : null
    if (m?.[1]) out.push(m[1])
  }
  return [...new Set(out)]
}

/** `404 {"message":"Query not found"}` : identifiant persisté périmé. */
export function isQueryNotFound(json: unknown): boolean {
  const m = (json as { message?: unknown } | null)?.message
  return typeof m === 'string' && /query not found/i.test(m)
}

/** Priorité d'un chunk : 0 favoris, 1 routes « history », 2 autre, `null` à ignorer. */
export function chunkPriority(url: string): 0 | 1 | 2 | null {
  const name = url.slice(url.lastIndexOf('/') + 1)
  if (/^bookmarks?-[\w-]{4,}\.m?js$/i.test(name)) return 0
  if (/^history-[\w-]{4,}\.m?js$/i.test(name)) return 1
  if (/^(icon-|[a-z]{2,3}(-[A-Za-z]{2,4})?-[\w-]{8}\.js$)/.test(name)) return null
  return 2
}

export interface DiscoverOptions {
  homeUrl: string
  swUrl: string
  /** Nom de l'opération cherchée (défaut `bookmarksQuery`). */
  operation?: string
  /** Plafond de scripts lus (défaut 140). */
  maxScripts?: number
  /** Requêtes en parallèle (défaut 6). */
  concurrency?: number
}

const fail = (error: string): DiscoveryResult => ({ ok: false, error })

/**
 * Découverte complète depuis l'arrière-plan, SANS cookie (`credentials: 'omit'` : le HTML déconnecté
 * donne une chaîne de modules déterministe). Ne lève jamais.
 */
export async function discoverXWeb(fetch: FetchFn, o: DiscoverOptions): Promise<DiscoveryResult> {
  const op = o.operation ?? XWEB_BOOKMARKS_OP
  const maxScripts = o.maxScripts ?? 140
  const concurrency = o.concurrency ?? 6
  const home = await fetch(o.homeUrl, {
    method: 'GET',
    credentials: 'omit',
    headers: { accept: 'text/html' },
  })
  if (home.status === 0) return fail(xt().syncErrors.xConfigNetwork)
  if (!home.text) return fail(xt().syncErrors.xConfigHome(home.status))
  const html = home.text
  const version = appVersion(html)
  const entries = findEntryScripts(html, o.homeUrl)
  if (entries.length === 0) {
    return fail(xt().syncErrors.xConfigNoEntry)
  }
  const prefix = entries[0]!.slice(0, entries[0]!.lastIndexOf('/') + 1)
  const inScope = (u: string) => u.startsWith(prefix)

  let bearer: string | null = null
  let bearerSource: XWebDiscovery['bearerSource'] = 'bundle'
  let found: { op: PersistedOp; url: string } | null = null
  let scripts = 0
  const seen = new Set<string>()
  // File priorisée : [priorité, profondeur, url].
  const queue: [number, number, string][] = entries.map((u) => [-1, 0, u])
  const push = (u: string, depth: number) => {
    if (seen.has(u) || !inScope(u)) return
    const p = chunkPriority(u)
    if (p === null) return
    // Chunks ordinaires : seulement depuis l'entrée et un niveau en dessous.
    if (p === 2 && depth > 2) return
    seen.add(u)
    queue.push([p, depth, u])
  }
  for (const e of entries) seen.add(e)

  while (queue.length > 0 && scripts < maxScripts && !found) {
    queue.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const batch = queue.splice(0, Math.min(concurrency, maxScripts - scripts))
    const results = await Promise.all(
      batch.map(([, depth, url]) =>
        fetch(url, { method: 'GET', credentials: 'omit' }).then((r) => ({ r, depth, url })),
      ),
    )
    for (const { r, depth, url } of results) {
      scripts += 1
      const js = r.text
      if (!js || r.status !== 200) continue
      bearer ??= findBearer(js)
      const hit = parsePersistedOps(js).find((x) => x.name === op)
      if (hit && !found) found = { op: hit, url }
      for (const ref of chunkRefs(js, url)) push(ref, depth + 1)
    }
  }
  if (!found) {
    return fail(xt().syncErrors.xConfigNoOp(op, scripts))
  }
  if (!bearer) {
    const sw = await fetch(o.swUrl, { method: 'GET', credentials: 'omit' })
    bearer = sw.text ? findBearer(sw.text) : null
    bearerSource = 'sw'
  }
  if (!bearer) {
    bearer = X_PUBLIC_BEARER
    bearerSource = 'constant'
  }
  return {
    ok: true,
    value: {
      queryId: found.op.id,
      operationName: found.op.name,
      providedVariables: providedDefaults(found.op.providedVariables),
      bearer,
      bearerSource,
      appVersion: version,
      entryUrl: entries[0]!,
      bundleUrl: found.url,
      scripts,
    },
  }
}
