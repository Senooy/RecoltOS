/**
 * Streaming download to a `.part` file: 60 s timeout, 2 GB cap, sha256 computed
 * while writing. HTTP 4xx errors are final (`http_4xx`), 5xx and network errors are retryable.
 * Per-CDN policies (headers, reaction to a refusal) via `registerFetchPolicy` (sync registers
 * its own there).
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
  /** Called on 401/403/410 (expired session, expired signed URL…). */
  onAuthError?: (status: number, url: string) => void
  /**
   * Specific download (e.g. HLS playlist → mp4 via ffmpeg `-c copy`): replaces
   * the direct HTTP stream. Must write `dst` and return the same result as `fetchToFile`.
   */
  download?: (url: string, dst: string, opts: FetchToFileOptions) => Promise<FetchedFile>
}

type PolicyEntry = { match: (url: URL) => boolean; resolve: (url: URL) => FetchPolicy }
const policies: PolicyEntry[] = []

/** Registers a policy; the last registered one that matches wins. */
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

/** Valid http(s) URL, otherwise `validation`. */
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
  /** `Content-Type` without parameters, lowercased. */
  contentType: string | null
  status: number
  /** First bytes (`file-type` typing). */
  head: Buffer
}

export interface FetchToFileOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
  headers?: Record<string, string>
}

/**
 * Downloads `url` into `dst` (created, overwritten). On failure, `dst` is deleted.
 * Throws `http_4xx` (final, `details.status`), `http_error` (5xx), `network`, `timeout`,
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
  if (policy.download)
    return policy.download(url, dst, { ...opts, headers: { ...policy.headers, ...opts.headers } })
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
    if (res.status === 401 || res.status === 403 || res.status === 410) {
      policy.onAuthError?.(res.status, url)
    }
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

/** Plausible extension from the URL (`.jpg` from `…/x.jpg?name=small`). */
export function extFromUrl(url: string): string | null {
  try {
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)
    return m?.[1]?.toLowerCase() ?? null
  } catch {
    return null
  }
}
