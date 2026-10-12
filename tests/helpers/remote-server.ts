/**
 * Fake local CDN (`node:http` on 127.0.0.1) for remote avatars and media: lets us test
 * `remote.fetch` / `avatar.fetch` without network. Routes:
 *   /avatar/<handle>.jpg   JPEG 64×64 whose hue depends on the handle
 *   /media/<nom>.<ext>     synthetic image (webp, jpg or png)
 *   /expired/…             403 (signed URL expired, like Instagram avatars)
 *   /slow/…                responds after `slowMs`
 *   /missing/…             404
 * Each request received is recorded in `requests`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { makeImage } from './synthetic-media'

export interface RemoteServer {
  /** Origin, e.g. `http://127.0.0.1:41234`. */
  origin: string
  requests: { method: string; url: string }[]
  url: (path: string) => string
  close: () => Promise<void>
}

export interface RemoteServerOptions {
  slowMs?: number
}

function hueFor(text: string): string {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const c = (n: number) => ((h >> n) & 0xff).toString(16).padStart(2, '0')
  return `#${c(0)}${c(8)}${c(16)}`
}

export async function startRemoteServer(options: RemoteServerOptions = {}): Promise<RemoteServer> {
  const requests: RemoteServer['requests'] = []
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? '/'
    requests.push({ method: req.method ?? 'GET', url })
    const { pathname } = new URL(url, 'http://127.0.0.1')
    const send = (status: number, type: string, body: Buffer | string = ''): void => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
      res.end(body)
    }
    try {
      if (pathname.startsWith('/expired/')) return send(403, 'text/plain', 'expired')
      if (pathname.startsWith('/missing/')) return send(404, 'text/plain', 'missing')
      if (pathname.startsWith('/slow/')) {
        await new Promise((r) => setTimeout(r, options.slowMs ?? 500))
      }
      const m = /\.(jpe?g|png|webp)$/i.exec(pathname)
      const ext = (m?.[1] ?? 'jpg').toLowerCase()
      const format = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg'
      const buf = await makeImage({
        width: pathname.startsWith('/avatar/') ? 64 : 96,
        height: pathname.startsWith('/avatar/') ? 64 : 64,
        color: hueFor(pathname),
        format,
      })
      send(200, `image/${format}`, buf)
    } catch (err) {
      send(500, 'text/plain', String(err))
    }
  }
  const server: Server = createServer((req, res) => void handle(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    origin,
    requests,
    url: (p) => `${origin}${p.startsWith('/') ? p : `/${p}`}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
