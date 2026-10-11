/**
 * Faux serveur local pour l'extension de test (`build:ext --test-base`) : une image, une page, et les
 * endpoints de sync X / Instagram / Cosmos rejoués depuis les fixtures SYNTHÉTIQUES. Journalise les
 * requêtes (méthode, chemin, en-têtes utiles) pour vérifier cookies, CSRF et `Origin`.
 */
import { readFileSync } from 'node:fs'
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
  /** Réponse forcée pour un chemin (statut + corps). */
  override(prefix: string, status: number, body: unknown): void
  close(): Promise<void>
}

const FIX = join(REPO_ROOT, 'tests/fixtures/sync')
const fixture = (p: string) => readFileSync(join(FIX, p))

/** PNG 64×64 opaque (couleur unie) pour l'enregistrement d'image. */
export function testPng(): Buffer {
  return readFileSync(join(REPO_ROOT, 'build/icon.png'))
}

export async function startFakePlatforms(port = 0): Promise<FakePlatforms> {
  const log: Logged[] = []
  const overrides = new Map<string, { status: number; body: unknown }>()
  const server = http.createServer((req, res) => {
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
    // ---- X
    if (p === '/x/') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end(
        fixture('x/bundle/accueil.html')
          .toString()
          .replace(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\//g, `${base}/abs/`),
      )
    }
    if (p.startsWith('/abs/main.')) {
      res.writeHead(200, { 'content-type': 'application/javascript' })
      return res.end(fixture('x/bundle/main.js'))
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
    // ---- Cosmos
    if (p === '/cosmos/graphql') {
      const q = url.searchParams.get('q')
      if (q === 'Me') return json(200, fixture('cosmos/me.json'))
      return json(200, fixture('cosmos/page-fin.json'))
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r))
  const actual = (server.address() as AddressInfo).port
  const base = `http://127.0.0.1:${actual}`
  return {
    base,
    port: actual,
    log,
    override: (prefix, status, body) => void overrides.set(prefix, { status, body }),
    close: () => new Promise((r) => server.close(() => r())),
  }
}
