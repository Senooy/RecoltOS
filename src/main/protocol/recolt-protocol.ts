/**
 * Cœur du protocole `recolt://<libraryId>/<root>/<rel>?v=<n>` (ARCHI §2.5, PLAN §1.7).
 * Sans import `electron` : `protocol.handle` (session par défaut et sessions hors écran) l'appelle
 * depuis `init.ts`, les tests l'appellent directement avec des `Request` Node.
 *
 * Garde-fous, dans l'ordre (aucun accès disque avant les contrôles syntaxiques) :
 *  1. méthode GET / HEAD (OPTIONS : pré-vol CORS), sinon 405 ;
 *  2. chemin décodé : octet NUL, antislash, segment vide, `.` ou `..` (y compris encodés) → 403 ;
 *  3. premier segment ∈ `MEDIA_ROOTS` (ni `snapshots`, ni `import`, ni `tmp`, ni la base) → 403 ;
 *  4. hôte = bibliothèque active, sinon 404 ;
 *  5. `realpath` du fichier sous `realpath(racine)/<MEDIA_ROOT>/` (liens symboliques sortants) → 403 ;
 *  6. fichier ordinaire, sinon 404.
 * Range à la main (seek vidéo fiable, y compris sur un mp4 de 391 Mo), `immutable` si `?v`,
 * `Access-Control-Allow-Origin: *` (canvas non « tainted » : glisser natif, pipette), HEAD.
 */
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { MEDIA_ROOTS } from '../../shared/enums'
import { mimeFromPath } from './mime'
import { parseRange } from './range'

export const RECOLT_PROTOCOL = 'recolt'

const MEDIA_ROOT_SET: ReadonlySet<string> = new Set(MEDIA_ROOTS)

/** Bibliothèque servie : seule la bibliothèque active l'est (une seule ouverte à la fois). */
export interface ServedLibrary {
  id: string
  /** Racine absolue de la bibliothèque. */
  root: string
}

export interface RecoltHandlerDeps {
  /** Bibliothèque correspondant à l'hôte de l'URL, ou `null` (inconnue / non ouverte). */
  libraryFor(id: string): ServedLibrary | null
  /** Journal des refus (403) : diagnostic, jamais le contenu des fichiers. */
  onDenied?(reason: string, url: string): void
}

export type RecoltHandler = ((req: Request) => Promise<Response>) & {
  /** Oublie les `realpath` de racines mémorisés (bascule de bibliothèque). */
  clearCache(): void
}

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'X-Content-Type-Options': 'nosniff',
  // Un SVG ou un fichier ouvert directement ne peut rien exécuter.
  'Content-Security-Policy':
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
}

function empty(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...BASE_HEADERS, ...extra } })
}

/** Chemin relatif décodé et validé, ou la raison du refus. */
export function parseRecoltPath(pathname: string): { rel: string } | { denied: string } {
  let rel: string
  try {
    rel = decodeURIComponent(pathname)
  } catch {
    return { denied: 'encodage invalide' }
  }
  if (rel.startsWith('/')) rel = rel.slice(1)
  if (rel.includes('\0')) return { denied: 'octet NUL' }
  if (rel.includes('\\')) return { denied: 'antislash' }
  const segments = rel.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    return { denied: 'segment vide, . ou ..' }
  }
  if (segments.length < 2 || !MEDIA_ROOT_SET.has(segments[0]!)) {
    return { denied: 'racine inconnue' }
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
      // Une racine illisible n'est pas mémorisée : la prochaine requête réessaie.
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
      return deny('URL invalide', req.url)
    }
    if (url.protocol !== `${RECOLT_PROTOCOL}:`) return deny('schéma', req.url)

    const parsed = parseRecoltPath(url.pathname)
    if ('denied' in parsed) return deny(parsed.denied, req.url)

    const lib = deps.libraryFor(url.hostname.toLowerCase())
    if (!lib) return empty(404)

    const root = path.resolve(lib.root)
    const abs = path.resolve(root, parsed.rel)
    if (!isStrictlyUnder(abs, root)) return deny('hors de la racine', req.url)

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
      return deny('lien hors des racines servies', req.url)
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
      // Requête déjà annulée : personne ne lira le corps, le handle est fermé par le `finally`.
      if (req.signal?.aborted) return empty(499)
      // `autoClose` ferme le handle à la fin, à l'erreur ou au `destroy()` du flux. Un corps qui n'est
      // jamais lu ni annulé ne déclenche rien : l'annulation de la requête (`signal`) détruit le flux.
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
