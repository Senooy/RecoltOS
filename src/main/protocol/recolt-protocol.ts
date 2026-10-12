/**
 * Core of the `recolt://<libraryId>/<root>/<rel>?v=<n>` protocol.
 * No `electron` import: `protocol.handle` (default session and off-screen sessions) calls it
 * from `init.ts`; the tests call it directly with Node `Request`s.
 *
 * Guardrails, in order (no disk access before the syntax checks):
 *  1. method GET / HEAD (OPTIONS: CORS preflight), otherwise 405;
 *  2. decoded path: NUL byte, backslash, empty segment, `.` or `..` (including encoded ones) → 403;
 *  3. first segment ∈ `MEDIA_ROOTS` (not `snapshots`, not `import`, not `tmp`, not the database) → 403;
 *  4. host = active library, otherwise 404;
 *  5. file `realpath` under `realpath(root)/<MEDIA_ROOT>/` (outgoing symbolic links) → 403;
 *  6. regular file, otherwise 404.
 * Range handled by hand (reliable video seeking, including on a 391 MB mp4), `immutable` if `?v`,
 * `Access-Control-Allow-Origin: *` (canvas not "tainted": native drag, color picker), HEAD.
 */
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { MEDIA_ROOTS } from '../../shared/enums'
import { mimeFromPath } from './mime'
import { parseRange } from './range'

export const RECOLT_PROTOCOL = 'recolt'

const MEDIA_ROOT_SET: ReadonlySet<string> = new Set(MEDIA_ROOTS)

/** Served library: only the active library is served (only one open at a time). */
export interface ServedLibrary {
  id: string
  /** Absolute root of the library. */
  root: string
}

export interface RecoltHandlerDeps {
  /** Library matching the URL host, or `null` (unknown / not open). */
  libraryFor(id: string): ServedLibrary | null
  /** Log of refusals (403): diagnostics, never file contents. */
  onDenied?(reason: string, url: string): void
}

export type RecoltHandler = ((req: Request) => Promise<Response>) & {
  /** Forgets the memoized root `realpath`s (library switch). */
  clearCache(): void
}

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'X-Content-Type-Options': 'nosniff',
  // An SVG or a file opened directly cannot execute anything.
  'Content-Security-Policy':
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
}

function empty(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...BASE_HEADERS, ...extra } })
}

/** Decoded and validated relative path, or the reason for refusal. */
export function parseRecoltPath(pathname: string): { rel: string } | { denied: string } {
  let rel: string
  try {
    rel = decodeURIComponent(pathname)
  } catch {
    return { denied: 'invalid encoding' }
  }
  if (rel.startsWith('/')) rel = rel.slice(1)
  if (rel.includes('\0')) return { denied: 'octet NUL' }
  if (rel.includes('\\')) return { denied: 'antislash' }
  const segments = rel.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    return { denied: 'empty segment, . or ..' }
  }
  if (segments.length < 2 || !MEDIA_ROOT_SET.has(segments[0]!)) {
    return { denied: 'unknown root' }
  }
  return { rel }
}

function isStrictlyUnder(child: string, parent: string): boolean {
  return child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)
}

export function createRecoltHandler(deps: RecoltHandlerDeps): RecoltHandler {
  const realRoots = new Map<string, Promise<string>>()
  const realRootOf = (root: string): Promise<string> => {
    let p = realRoots.get(root)
    if (!p) {
      p = fs.promises.realpath(root)
      // An unreadable root is not memoized: the next request retries.
      p.catch(() => realRoots.delete(root))
      realRoots.set(root, p)
    }
    return p
  }

  const deny = (reason: string, url: string): Response => {
    deps.onDenied?.(reason, url)
    return empty(403)
  }

  const handler = async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return empty(204, {
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Max-Age': '86400',
      })
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return empty(405, { Allow: 'GET, HEAD, OPTIONS' })
    }

    let url: URL
    try {
      url = new URL(req.url)
    } catch {
      return deny('invalid URL', req.url)
    }
    if (url.protocol !== `${RECOLT_PROTOCOL}:`) return deny('scheme', req.url)

    const parsed = parseRecoltPath(url.pathname)
    if ('denied' in parsed) return deny(parsed.denied, req.url)

    const lib = deps.libraryFor(url.hostname.toLowerCase())
    if (!lib) return empty(404)

    const root = path.resolve(lib.root)
    const abs = path.resolve(root, parsed.rel)
    if (!isStrictlyUnder(abs, root)) return deny('outside the root', req.url)

    let real: string
    let realRoot: string
    try {
      realRoot = await realRootOf(root)
      real = await fs.promises.realpath(abs)
    } catch {
      return empty(404)
    }
    const inside = path.relative(realRoot, real)
    const first = inside.split(path.sep)[0] ?? ''
    if (!isStrictlyUnder(real, realRoot) || !MEDIA_ROOT_SET.has(first)) {
      return deny('link outside the served roots', req.url)
    }

    let handle: fs.promises.FileHandle
    try {
      handle = await fs.promises.open(real, 'r')
    } catch {
      return empty(404)
    }
    let keepOpen = false
    try {
      const st = await handle.stat()
      if (!st.isFile()) return empty(404)
      const size = st.size

      const headers: Record<string, string> = {
        ...BASE_HEADERS,
        'Content-Type': mimeFromPath(real),
        'Accept-Ranges': 'bytes',
        'Cache-Control': url.searchParams.has('v')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      }

      const range = parseRange(req.headers.get('range'), size)
      if (range.kind === 'unsatisfiable') {
        return empty(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' })
      }
      let status = 200
      let start = 0
      let end = size - 1
      if (range.kind === 'partial') {
        status = 206
        start = range.start
        end = range.end
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      }
      const length = size === 0 ? 0 : end - start + 1
      headers['Content-Length'] = String(length)

      if (req.method === 'HEAD' || length === 0) {
        return new Response(null, { status, headers })
      }
      // Request already aborted: nobody will read the body; the handle is closed by the `finally`.
      if (req.signal?.aborted) return empty(499)
      // `autoClose` closes the handle at the end, on error, or on the stream's `destroy()`. A body
      // that is never read nor aborted triggers nothing: aborting the request (`signal`) destroys
      // the stream.
      const stream = handle.createReadStream({ start, end, autoClose: true })
      const signal = req.signal
      if (signal) {
        const onAbort = (): void => {
          stream.destroy()
        }
        signal.addEventListener('abort', onAbort, { once: true })
        stream.once('close', () => signal.removeEventListener('abort', onAbort))
      }
      const body = Readable.toWeb(stream)
      keepOpen = true
      return new Response(body as ReadableStream<Uint8Array>, { status, headers })
    } finally {
      if (!keepOpen) await handle.close().catch(() => undefined)
    }
  }

  return Object.assign(handler, { clearCache: () => realRoots.clear() })
}
