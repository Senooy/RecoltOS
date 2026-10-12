/**
 * Fake local server for the test extension (`build:ext --test-base`): one image, one page, and the
 * X / Instagram / Cosmos sync endpoints replayed from the SYNTHETIC fixtures. Logs the
 * requests (method, path, useful headers) to check cookies, CSRF and `Origin`.
 */
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { REPO_ROOT } from '../helpers/paths'

export interface Logged {
  method: string
  path: string
  cookie: string
  origin: string
  referer: string
  csrf: string
  igCsrf: string
  auth: string
}

export interface FakePlatforms {
  base: string
  port: number
  log: Logged[]
  /** Reports from `POST /selftest` of `--selftest` builds. */
  selfTests: unknown[]
  /** Forced response for a path (status + body). */
  override(prefix: string, status: number, body: unknown): void
  close(): Promise<void>
}

const FIX = join(REPO_ROOT, 'tests/fixtures/sync')
const fixture = (p: string) => readFileSync(join(FIX, p))

/** Opaque 64×64 PNG (solid color) for the image record. */
export function testPng(): Buffer {
  return readFileSync(join(REPO_ROOT, 'build/icon.png'))
}

export async function startFakePlatforms(port = 0, hostName = '127.0.0.1'): Promise<FakePlatforms> {
  const log: Logged[] = []
  const overrides = new Map<string, { status: number; body: unknown }>()
  const selfTests: unknown[] = []
  const server = http.createServer((req, res) => {
    if (req.url === '/selftest' && req.method === 'POST') {
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString()))
      req.on('end', () => {
        try {
          selfTests.push(JSON.parse(body))
        } catch {
          selfTests.push({ invalid: body })
        }
        res.end('ok')
      })
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const h = (k: string) => String(req.headers[k] ?? '')
    log.push({
      method: req.method ?? 'GET',
      path: url.pathname + url.search,
      cookie: h('cookie'),
      origin: h('origin'),
      referer: h('referer'),
      csrf: h('x-csrf-token'),
      igCsrf: h('x-csrftoken'),
      auth: h('authorization') ? 'présent' : '',
    })
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
    }
    for (const [prefix, o] of overrides) {
      if (url.pathname.startsWith(prefix)) return json(o.status, o.body)
    }
    const p = url.pathname
    if (p === '/setcookies') {
      res.writeHead(200, {
        'set-cookie': [
          'ct0=csrf-selftest; Path=/; SameSite=Lax',
          'auth_token=session-selftest; Path=/; HttpOnly; SameSite=Lax',
        ],
      })
      return res.end('ok')
    }
    if (p === '/img.png') {
      res.writeHead(200, { 'content-type': 'image/png' })
      return res.end(testPng())
    }
    if (p === '/page.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(
        '<!doctype html><html><head><title>Page de test</title><meta property="og:image" content="/img.png"></head><body><img id="i" src="/img.png" width="64" height="64"></body></html>',
      )
    }
    // ---- X: fake x-web client, gateway for persisted requests
    if (p === '/x/') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end(
        fixture('x/xweb/accueil.html')
          .toString()
          .replace(/https:\/\/abs\.twimg\.com\//g, `${base}/abs/`),
      )
    }
    if (p === '/x/sw.js') {
      res.writeHead(200, { 'content-type': 'application/javascript' })
      return res.end(fixture('x/xweb/sw.js'))
    }
    if (p.startsWith('/abs/x-web/')) {
      const name = p.slice(p.lastIndexOf('/') + 1)
      if (/^[\w.-]+\.js$/.test(name) && existsSync(join(FIX, 'x/xweb', name))) {
        res.writeHead(200, { 'content-type': 'application/javascript' })
        return res.end(fixture(`x/xweb/${name}`))
      }
      res.writeHead(404)
      return res.end()
    }
    if (/^\/x\/i\/api\/graphql\/[^/]+\/bookmarksQuery$/.test(p)) {
      const vars = JSON.parse(url.searchParams.get('variables') ?? '{}') as { cursor?: string }
      return json(200, fixture(vars.cursor ? 'x/xweb-page-fin.json' : 'x/xweb-page-1.json'))
    }
    if (/^\/x\/i\/api\/graphql\/[^/]+\/Bookmarks$/.test(p)) {
      const vars = JSON.parse(url.searchParams.get('variables') ?? '{}') as { cursor?: string }
      return json(200, fixture(vars.cursor ? 'x/curseur-fin.json' : 'x/curseur-page1.json'))
    }
    // ---- Instagram
    if (p === '/instagram/api/v1/feed/saved/posts/') {
      return json(
        200,
        fixture(
          url.searchParams.get('max_id') ? 'instagram/page-fin.json' : 'instagram/page-1.json',
        ),
      )
    }
    // ---- Cosmos: access token (fake unsigned JWT) then GraphQL
    if (p === '/cosmos/api/refresh-token') {
      const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
      return json(200, {
        accessToken: `${b64({ alg: 'none' })}.${b64({ exp: 4_000_000_000, eid: 8800001 })}.sig`,
      })
    }
    if (p === '/cosmos/graphql') return json(200, fixture('cosmos/page-fin.json'))
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r))
  const actual = (server.address() as AddressInfo).port
  const base = `http://${hostName}:${actual}`
  return {
    base,
    port: actual,
    log,
    selfTests,
    override: (prefix, status, body) => void overrides.set(prefix, { status, body }),
    close: () => new Promise((r) => server.close(() => r())),
  }
}
