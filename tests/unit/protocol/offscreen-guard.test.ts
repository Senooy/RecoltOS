/** WP-05 — garde `recolt://` des sessions hors écran : seule la page interne `offscreen.html` est servie. */
import { describe, expect, it, vi } from 'vitest'
import {
  guardOffscreenHandler,
  isInternalOffscreenUrl,
} from '../../../src/main/protocol/offscreen-guard'

describe('isInternalOffscreenUrl', () => {
  const dev = 'http://localhost:5173/'
  it.each([
    [
      'file:///Applications/RecoltOS.app/Contents/Resources/app.asar/out/renderer/offscreen.html?render=tweet-card',
      null,
      true,
    ],
    ['file:///tmp/x/renderer/offscreen.html', dev, true],
    ['http://localhost:5173/offscreen.html?render=space-stage', dev, true],
    ['http://localhost:5173/offscreen.html', null, false],
    ['http://localhost:5173/index.html', dev, false],
    ['http://localhost:5174/offscreen.html', dev, false],
    ['https://evil.example/offscreen.html', dev, false],
    ['file:///Users/x/Downloads/offscreen.html', dev, false],
    ['file:///tmp/renderer/offscreen.html/../../etc/x.html', dev, false],
    ['about:blank', dev, false],
    ['recolt://default/thumbs/a.webp', dev, false],
    ['pas une url', dev, false],
  ])('%s (rendererUrl=%s) → %s', (url, renderer, expected) => {
    expect(isInternalOffscreenUrl(url, renderer)).toBe(expected)
  })
})

describe('guardOffscreenHandler', () => {
  const ok = () => Promise.resolve(new Response('ok', { status: 200 }))
  const req = new Request('recolt://default/thumbs/a.webp')
  const internal = 'file:///app/out/renderer/offscreen.html?render=tweet-card'

  it('refuse (403) sans page, avec une page distante ou mixte, et journalise', async () => {
    for (const pages of [[], ['https://evil.example/'], [internal, 'https://evil.example/']]) {
      const onDenied = vi.fn()
      const h = guardOffscreenHandler({}, ok, {
        pageUrlsOf: () => pages,
        rendererUrl: null,
        onDenied,
      })
      expect((await h(req)).status).toBe(403)
      expect(onDenied).toHaveBeenCalledTimes(1)
    }
  })

  it('sert la page interne, y compris au pré-vol OPTIONS (délégué)', async () => {
    const h = guardOffscreenHandler({}, ok, { pageUrlsOf: () => [internal], rendererUrl: null })
    expect((await h(req)).status).toBe(200)
  })

  it('relit les pages à chaque requête (partition recyclée)', async () => {
    let pages = [internal]
    const h = guardOffscreenHandler({}, ok, { pageUrlsOf: () => pages, rendererUrl: null })
    expect((await h(req)).status).toBe(200)
    pages = ['https://evil.example/']
    expect((await h(req)).status).toBe(403)
  })
})
