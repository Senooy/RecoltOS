/**
 * Outils communs aux parseurs de sync : accès défensifs à du JSON inconnu, URL https,
 * construction et validation de `post_meta` v1, comptage des entrées écartées. Aucun effet de bord.
 */
import {
  PostMetaSchema,
  type PostMedia,
  type PostMeta,
  type QuotedPost,
} from '../../../shared/post-meta'
import type {
  NormalizedAuthor,
  NormalizedMedia,
  PageParseError,
  ParseError,
  ParseIssue,
  ParseStats,
  SyncPlatform,
} from './types'

/** Plafonds défensifs (une page réelle en est très loin). */
export const MAX_ENTRIES = 2000
export const MAX_MEDIA_PER_POST = 50
export const MAX_ISSUES = 100
export const MAX_TEXT = 30_000
export const MAX_URL = 8192
export const MAX_CURSOR = 4096
export const MAX_ID = 64

export type Json = Record<string, unknown>

export function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Objet ou `{}` : permet d'enchaîner les lectures sans test à chaque niveau. */
export function obj(v: unknown): Json {
  return isObj(v) ? v : {}
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/** Chaîne non vide après `trim`, sinon `null`. */
export function nonEmpty(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Entier positif (dimensions, durées), sinon `null`. */
export function posInt(v: unknown): number | null {
  const n = num(v)
  return n !== null && n > 0 ? Math.round(n) : null
}

/** Identifiant : chaîne ou nombre entier, caractères sûrs, longueur bornée. */
export function idStr(v: unknown, pattern: RegExp = /^[A-Za-z0-9_-]+$/): string | null {
  const s = typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? String(v) : str(v)
  if (s === null || s.length === 0 || s.length > MAX_ID) return null
  return pattern.test(s) ? s : null
}

export function cursorStr(v: unknown): string | null {
  const s = nonEmpty(v)
  return s !== null && s.length <= MAX_CURSOR ? s : null
}

/**
 * URL distante exploitable : absolue, `https:` (ou `http:` si `allowHttp`), sans identifiants
 * embarqués, longueur bornée. Renvoie la forme sérialisée par `URL`, sinon `null`.
 */
export function webUrl(v: unknown, allowHttp = false): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_URL) return null
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) return null
  if (u.username !== '' || u.password !== '' || u.hostname === '') return null
  return u.href
}

/** `https://…` avec le paramètre `name` retiré de la requête (le reste est conservé). */
export function withoutParam(url: string, name: string): string {
  const u = new URL(url)
  u.searchParams.delete(name)
  return u.href
}

export function withParam(url: string, name: string, value: string): string {
  const u = new URL(url)
  u.searchParams.set(name, value)
  return u.href
}

/** Handle sans `@` ni espaces ; `null` s'il est vide. */
export function cleanHandle(v: unknown): string | null {
  const s = nonEmpty(v)
  if (s === null) return null
  const h = s.replace(/^@+/, '').trim()
  return h === '' || h.length > 100 || /\s/.test(h) ? null : h
}

/** Texte : caractères de contrôle retirés (sauf saut de ligne et tabulation), borné, `trim`. */
export function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  if (t === '') return null
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) : t
}

/** Date ISO / RFC → ms epoch, sinon `null`. */
export function dateMs(v: unknown): number | null {
  if (typeof v !== 'string' || v.length > 100) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

export function emptyStats(): ParseStats {
  return { entries: 0, parsed: 0, unavailable: 0, ignored: 0, malformed: 0, mediaDropped: 0 }
}

/** Collecteur de stats et d'anomalies pour une page. */
export class PageLog {
  readonly stats: ParseStats = emptyStats()
  readonly issues: ParseIssue[] = []

  note(kind: ParseIssue['kind'], index: number, id: string | null, reason: string): void {
    if (kind === 'unavailable') this.stats.unavailable += 1
    else if (kind === 'ignored') this.stats.ignored += 1
    else if (kind === 'malformed') this.stats.malformed += 1
    else this.stats.mediaDropped += 1
    if (this.issues.length < MAX_ISSUES) this.issues.push({ index, id, kind, reason })
  }
}

/** Échec d'une entrée isolée : lancée dans un parseur d'entrée, attrapée par la boucle de page. */
export class EntryError extends Error {}

export function fail(reason: string): never {
  throw new EntryError(reason)
}

export function errorResult(
  platform: SyncPlatform,
  code: ParseError['code'],
  reason: string,
  message: string,
  extra?: Pick<ParseError, 'missingFeatures'>,
): PageParseError {
  return {
    ok: false,
    platform,
    error: { code, reason, message: message.slice(0, 500), ...extra },
  }
}

/** Raison lisible d'une exception inattendue (jamais propagée). */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200)
  return 'erreur inconnue'
}

export function emptyMedia(type: 'image' | 'video'): NormalizedMedia {
  return {
    type,
    url: null,
    fallbackUrl: null,
    hlsUrl: null,
    hlsOnly: false,
    posterUrl: null,
    width: null,
    height: null,
    durationMs: null,
    gif: false,
  }
}

/** `NormalizedMedia` → `PostMedia` v1 (la vidéo HLS seule garde son URL `.m3u8`). */
export function toPostMedia(m: NormalizedMedia): PostMedia {
  return {
    type: m.type,
    remoteUrl: m.url ?? m.hlsUrl,
    posterUrl: m.posterUrl,
    mediaUuid: null,
  }
}

export function toPostAuthor(a: NormalizedAuthor | null): PostMeta['author'] {
  if (!a || (a.name === null && a.handle === null)) return null
  return { name: a.name, handle: a.handle, avatarUrl: a.avatarUrl }
}

export interface PostMetaParts {
  platform: SyncPlatform
  author: NormalizedAuthor | null
  text: string | null
  url: string
  postedAt: number | null
  media: NormalizedMedia[]
  quoted?: QuotedPost | null
  thread?: PostMeta['thread']
}

/** Construit et valide `post_meta` v1 ; une forme invalide isole l'entrée. */
export function buildPostMeta(p: PostMetaParts): PostMeta {
  const r = PostMetaSchema.safeParse({
    v: 1,
    platform: p.platform,
    author: toPostAuthor(p.author),
    text: p.text,
    url: p.url,
    postedAt: p.postedAt,
    media: p.media.map(toPostMedia),
    quoted: p.quoted ?? null,
    thread: p.thread ?? [],
  })
  if (!r.success) fail('post_meta invalide')
  return r.data
}

/** Auteurs dédupliqués par handle (insensible à la casse), ceux sans handle ignorés. */
export function uniqueAuthors(list: (NormalizedAuthor | null | undefined)[]): NormalizedAuthor[] {
  const seen = new Set<string>()
  const out: NormalizedAuthor[] = []
  for (const a of list) {
    if (!a?.handle) continue
    const k = a.handle.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(a)
  }
  return out
}

/** Applique `requestCursor` : un curseur identique à celui demandé termine la pagination. */
export function finalCursor(next: string | null, requestCursor: string | null | undefined) {
  return next !== null && requestCursor != null && next === requestCursor ? null : next
}

/** JSON brut ou chaîne JSON → valeur ; une chaîne illisible donne `undefined`. */
export function coerceJson(input: unknown): unknown {
  if (typeof input !== 'string') return input
  try {
    return JSON.parse(input) as unknown
  } catch {
    return undefined
  }
}
