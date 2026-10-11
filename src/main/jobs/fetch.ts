/**
 * Téléchargement en flux vers un fichier `.part` (ARCHI §5.2 étape 3) : délai de 60 s, plafond de
 * 2 Go, sha256 calculé pendant l'écriture. Les erreurs HTTP 4xx sont définitives (`http_4xx`), les
 * 5xx et erreurs réseau réessayables. Politiques par CDN (en-têtes, réaction à un refus) via
 * `registerFetchPolicy` (ERRATA §B : la sync WP-56 y enregistre les siennes).
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AppError } from '../../shared/errors'
import type { FetchFn } from './handlers/types'

export const FETCH_TIMEOUT_MS = 60_000
export const FETCH_MAX_BYTES = 2 * 1024 ** 3

export interface FetchPolicy {
  headers?: Record<string, string>
  /** Appelé sur 401/403 (session expirée, URL signée périmée…). */
  onAuthError?: (status: number, url: string) => void
}

type PolicyEntry = { match: (url: URL) => boolean; resolve: (url: URL) => FetchPolicy }
const policies: PolicyEntry[] = []

/** Enregistre une politique ; la dernière enregistrée qui correspond gagne. */
export function registerFetchPolicy(
  match: (url: URL) => boolean,
  resolve: (url: URL) => FetchPolicy,
): () => void {
  const entry = { match, resolve }
  policies.push(entry)
  return () => {
    const i = policies.indexOf(entry)
    if (i >= 0) policies.splice(i, 1)
  }
}

export function policyFor(url: string): FetchPolicy {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return {}
  }
  for (let i = policies.length - 1; i >= 0; i--) {
    const p = policies[i]!
    if (p.match(u)) return p.resolve(u)
  }
  return {}
}

/** URL http(s) valide, sinon `validation`. */
export function assertWebUrl(url: string): URL {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new AppError('validation', 'adresse invalide')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new AppError('validation', 'adresse http(s) attendue')
  }
  return u
}

export interface FetchedFile {
  bytes: number
  sha256: string
  /** `Content-Type` sans paramètres, en minuscules. */
  contentType: string | null
  status: number
  /** Premiers octets (typage `file-type`). */
  head: Buffer
}

export interface FetchToFileOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
  headers?: Record<string, string>
}

/**
 * Télécharge `url` dans `dst` (créé, écrasé). En cas d'échec, `dst` est supprimé.
 * Lève `http_4xx` (définitif, `details.status`), `http_error` (5xx), `network`, `timeout`,
 * `limit_exceeded`, `cancelled`.
 */
export async function fetchToFile(
  fetchFn: FetchFn,
  url: string,
  dst: string,
  opts: FetchToFileOptions = {},
): Promise<FetchedFile> {
  assertWebUrl(url)
  const policy = policyFor(url)
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  let res: Response
  try {
    res = await fetchFn(url, { headers: { ...policy.headers, ...opts.headers }, signal })
  } catch (err) {
    if (opts.signal?.aborted) throw new AppError('cancelled', 'téléchargement annulé')
    if (timeout.aborted) throw new AppError('timeout', 'téléchargement trop long')
    throw new AppError('network', 'réseau indisponible', {
      message: err instanceof Error ? err.message : String(err),
    })
  }
  if (res.status >= 400) {
    if (res.status === 401 || res.status === 403) policy.onAuthError?.(res.status, url)
    await res.body?.cancel().catch(() => undefined)
    if (res.status < 500 && res.status !== 408 && res.status !== 429) {
      throw new AppError('http_4xx', `réponse ${res.status}`, { status: res.status })
    }
    throw new AppError('http_error', `réponse ${res.status}`, { status: res.status })
  }
  const max = opts.maxBytes ?? FETCH_MAX_BYTES
  const declared = Number(res.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined)
    throw new AppError('limit_exceeded', 'fichier trop volumineux')
  }
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
  await mkdir(dirname(dst), { recursive: true })
  const hash = createHash('sha256')
  const out = createWriteStream(dst)
  const headParts: Buffer[] = []
  let headLen = 0
  let bytes = 0
  try {
    if (!res.body) throw new AppError('network', 'réponse vide')
    const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
    for (;;) {
      const r = await reader.read()
      if (r.done) break
      const chunk: Buffer = Buffer.from(r.value)
      bytes += chunk.length
      if (bytes > max) {
        await reader.cancel().catch(() => undefined)
        throw new AppError('limit_exceeded', 'fichier trop volumineux')
      }
      if (headLen < 4100) {
        headParts.push(chunk.subarray(0, 4100 - headLen))
        headLen += Math.min(chunk.length, 4100 - headLen)
      }
      hash.update(chunk)
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', r))
    }
    await new Promise<void>((resolve, reject) => {
      out.end((err?: Error | null) => (err ? reject(err) : resolve()))
    })
  } catch (err) {
    out.destroy()
    await rm(dst, { force: true })
    if (err instanceof AppError) throw err
    if (opts.signal?.aborted) throw new AppError('cancelled', 'téléchargement annulé')
    if (timeout.aborted) throw new AppError('timeout', 'téléchargement trop long')
    throw new AppError('network', 'téléchargement interrompu', {
      message: err instanceof Error ? err.message : String(err),
    })
  }
  if (bytes === 0) {
    await rm(dst, { force: true })
    throw new AppError('http_4xx', 'réponse vide', { status: res.status })
  }
  return {
    bytes,
    sha256: hash.digest('hex'),
    contentType: contentType || null,
    status: res.status,
    head: Buffer.concat(headParts),
  }
}

/** Extension plausible d'après l'URL (`.jpg` de `…/x.jpg?name=small`). */
export function extFromUrl(url: string): string | null {
  try {
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)
    return m?.[1]?.toLowerCase() ?? null
  } catch {
    return null
  }
}
