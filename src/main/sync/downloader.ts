/**
 * Téléchargement des médias synchronisés PAR L'APP (SYNC §6.4, ERRATA §B, §G.2) : étend
 * `media.download` (WP-10) par `registerFetchPolicy`, sans remplacer le handler.
 * - `Referer` selon le CDN, `User-Agent` de navigateur, AUCUN cookie ;
 * - listes de lecture HLS (`.m3u8`) → mp4 par ffmpeg `-c copy` ;
 * - Instagram : 403/410 sur une URL signée périmée → `onExpired` (le coordinateur demande un
 *   `item.refresh` à l'extension, dans le budget Instagram).
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { open, rm, stat } from 'node:fs/promises'
import { AppError } from '../../shared/errors'
import { registerFetchPolicy, type FetchedFile, type FetchToFileOptions } from '../jobs/fetch'

export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

const hostIs = (u: URL, ...domains: string[]) =>
  domains.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))

export const isTwitterCdn = (u: URL) => hostIs(u, 'twimg.com')
export const isInstagramCdn = (u: URL) => hostIs(u, 'cdninstagram.com', 'fbcdn.net')
export const isCosmosCdn = (u: URL) => hostIs(u, 'cdn.cosmos.so', 'mux.com')

export function refererFor(u: URL): string | null {
  if (isTwitterCdn(u)) return 'https://x.com/'
  if (isInstagramCdn(u)) return 'https://www.instagram.com/'
  if (isCosmosCdn(u)) return 'https://www.cosmos.so/'
  return null
}

/** Résumé d'un fichier écrit (même forme que `fetchToFile`). */
async function describe(dst: string, status = 200): Promise<FetchedFile> {
  const st = await stat(dst)
  if (st.size === 0) throw new AppError('http_4xx', 'réponse vide', { status })
  const fh = await open(dst, 'r')
  const hash = createHash('sha256')
  const head = Buffer.alloc(Math.min(4100, st.size))
  try {
    await fh.read(head, 0, head.length, 0)
    for await (const chunk of fh.createReadStream({ start: 0 })) hash.update(chunk as Buffer)
  } finally {
    await fh.close().catch(() => undefined)
  }
  return { bytes: st.size, sha256: hash.digest('hex'), contentType: 'video/mp4', status, head }
}

/** HLS → mp4 sans réencodage (`ffmpeg -c copy`), en-têtes du CDN, délai 10 min. */
export function hlsDownload(ffmpeg: () => string | null) {
  return async (url: string, dst: string, opts: FetchToFileOptions): Promise<FetchedFile> => {
    const bin = ffmpeg()
    if (!bin) throw new AppError('tool_missing', 'ffmpeg est requis pour cette vidéo')
    const headers = Object.entries(opts.headers ?? {})
      .map(([k, v]) => `${k}: ${v}\r\n`)
      .join('')
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...(headers ? ['-headers', headers] : []),
      '-i',
      url,
      '-c',
      'copy',
      '-bsf:a',
      'aac_adtstoasc',
      '-movflags',
      '+faststart',
      '-f',
      'mp4',
      dst,
    ]
    await new Promise<void>((resolve, reject) => {
      const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let err = ''
      p.stderr.on('data', (d: Buffer) => {
        err = (err + d.toString()).slice(-2000)
      })
      const timer = setTimeout(() => p.kill('SIGKILL'), opts.timeoutMs ?? 600_000)
      opts.signal?.addEventListener('abort', () => p.kill('SIGKILL'), { once: true })
      p.on('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
      p.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else if (/40[134]/.test(err))
          reject(new AppError('http_4xx', 'liste de lecture refusée', { status: 403 }))
        else reject(new AppError('network', 'ffmpeg a échoué', { message: err }))
      })
    })
    try {
      return await describe(dst)
    } catch (e) {
      await rm(dst, { force: true })
      throw e
    }
  }
}

export interface DownloaderDeps {
  ffmpeg: () => string | null
  /** URL signée Instagram périmée (403/410). */
  onExpired: (url: string, status: number) => void
}

/** Enregistre les politiques par CDN ; rend la fonction de retrait. */
export function registerSyncFetchPolicies(deps: DownloaderDeps): () => void {
  const hls = hlsDownload(deps.ffmpeg)
  const offs = [
    registerFetchPolicy(
      (u) => isTwitterCdn(u) || isInstagramCdn(u) || isCosmosCdn(u),
      (u) => {
        const referer = refererFor(u)
        return {
          headers: { 'User-Agent': BROWSER_UA, ...(referer ? { Referer: referer } : {}) },
          ...(u.pathname.endsWith('.m3u8') ? { download: hls } : {}),
          ...(isInstagramCdn(u)
            ? { onAuthError: (status: number, url: string) => deps.onExpired(url, status) }
            : {}),
        }
      },
    ),
  ]
  return () => {
    for (const off of offs) off()
  }
}
