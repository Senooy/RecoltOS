/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- fixtures JSON mutées en place (copie `structuredClone` typée `any`) */
/**
 * Cosmos parser on the synthetic fixtures.
 */
import { describe, expect, it } from 'vitest'
import {
  cosmosOriginal,
  parseCosmosSavesPage,
  type CosmosPostExtra,
} from '../../../../src/main/sync/parsers'
import { checkInvariants, expectOk, fixture, mutable } from './helpers'

const parse = (name: string) => {
  const r = parseCosmosSavesPage(fixture('cosmos', name))
  checkInvariants(r)
  return expectOk(r)
}
const cExtra = (e: unknown) => e as CosmosPostExtra

describe('parseCosmosSavesPage — fixtures', () => {
  it('image: cosmos:<id> key, URL /e/<id>, original without ?format=webp, jpeg fallback', () => {
    const p = parse('image.json').posts[0]!
    expect(p.sourceKey).toBe('cosmos:1400000001')
    expect(p.sourceUrl).toBe('https://www.cosmos.so/e/1400000001')
    expect(p.kind).toBe('image')
    expect(p.media[0]).toMatchObject({
      type: 'image',
      url: 'https://cdn.cosmos.so/0f0e0d0c-aaaa-4b3a-9f8e-7d6c5b4a3001',
      fallbackUrl: 'https://cdn.cosmos.so/0f0e0d0c-aaaa-4b3a-9f8e-7d6c5b4a3001?format=jpeg',
      width: 1200,
      height: 1500,
    })
    expect(cExtra(p.extra)).toMatchObject({
      savedAt: Date.UTC(2026, 9, 1, 9, 0, 0),
      generatedCaption: 'Description générée 1',
      linkUrl: null,
    })
    expect(p.postMeta).toMatchObject({ platform: 'cosmos', url: p.sourceUrl, postedAt: null })
  })

  it('multi: media and multipleMedia deduplicated (3 images)', () => {
    const p = parse('multi.json').posts[0]!
    expect(p.media.map((m) => m.url)).toEqual([
      'https://cdn.cosmos.so/0f0e0d0c-bbbb-4b3a-9f8e-7d6c5b4a3006',
      'https://cdn.cosmos.so/0f0e0d0c-cccc-4b3a-9f8e-7d6c5b4a3006',
      'https://cdn.cosmos.so/0f0e0d0c-dddd-4b3a-9f8e-7d6c5b4a3006',
    ])
  })

  it('video: mux.downloadableUrl, poster without format; fallbacks mp4Url then video.url', () => {
    const p = parse('video.json').posts[0]!
    expect(p.kind).toBe('video')
    expect(p.media).toHaveLength(1)
    expect(p.media[0]).toMatchObject({
      url: 'https://stream.mux.com/syntheticPlayback3/capped-1080p.mp4',
      posterUrl: 'https://cdn.cosmos.so/0f0e0d0c-eeee-4b3a-9f8e-7d6c5b4a3003',
    })
    const j = mutable('cosmos', 'video.json')
    delete j.data.allElementsV2.items[0].mux.downloadableUrl
    expect(expectOk(parseCosmosSavesPage(j)).posts[0]!.media[0]!.url).toBe(
      'https://stream.mux.com/syntheticPlayback3/high.mp4',
    )
    j.data.allElementsV2.items[0].mux = null
    expect(expectOk(parseCosmosSavesPage(j)).posts[0]!.media[0]!.url).toBe(
      'https://cdn.cosmos.so/video-3.mp4',
    )
  })

  it('website: kind url, link and title; empty source.author → no author', () => {
    const p = parse('lien.json').posts[0]!
    expect(p.kind).toBe('url')
    expect(p.text).toBe('Site de référence 2')
    expect(p.author).toBeNull()
    expect(cExtra(p.extra)).toMatchObject({
      linkUrl: 'https://example.com/site/2',
      websiteTitle: 'Site de référence 2',
    })
  })

  it('text tile: ignored and counted, the neighbouring image is kept', () => {
    const r = parse('texte.json')
    expect(r.posts.map((p) => p.sourceKey)).toEqual(['cosmos:1400000005'])
    expect(r.stats).toMatchObject({ entries: 2, parsed: 1, ignored: 1, malformed: 0 })
    expect(r.issues[0]).toMatchObject({ kind: 'ignored', id: '1400000004' })
    expect(r.posts[0]!.position).toBe(0)
  })

  it('pagination: cursor on page 1, null at the end', () => {
    const r = parse('page-1.json')
    expect(r.posts).toHaveLength(8)
    expect(r.nextCursor).toBe('Y29zbW9zLXBhZ2UtMg')
    expect(r.posts.filter((p) => p.kind === 'url')).toHaveLength(2)
    expect(parse('page-fin.json').nextCursor).toBeNull()
  })

  it('not logged in → auth_required; `me` response → api_changed', () => {
    expect(parseCosmosSavesPage(fixture('cosmos', 'non-connecte.json'))).toMatchObject({
      ok: false,
      error: { code: 'auth_required' },
    })
    expect(parseCosmosSavesPage(fixture('cosmos', 'me.json'))).toMatchObject({
      ok: false,
      error: { code: 'api_changed', reason: 'unknown_shape' },
    })
  })
})

describe('parseCosmosSavesPage — robustness', () => {
  it('corrupted items isolated, cursor kept', () => {
    const j = mutable('cosmos', 'page-1.json')
    const items = j.data.allElementsV2.items
    delete items[1].id
    items[2].media = { url: 'data:image/png;base64,AAAA' }
    items[4] = 'texte'
    const r = expectOk(parseCosmosSavesPage(j))
    checkInvariants(r)
    expect(r.posts).toHaveLength(5)
    expect(r.stats.malformed).toBe(3)
    expect(r.stats.mediaDropped).toBe(1)
    expect(r.nextCursor).toBe('Y29zbW9zLXBhZ2UtMg')
  })

  it('empty page with cursor → end; cursor identical to the requested one → end', () => {
    const j = mutable('cosmos', 'page-1.json')
    expect(
      expectOk(parseCosmosSavesPage(j, { requestCursor: 'Y29zbW9zLXBhZ2UtMg' })).nextCursor,
    ).toBeNull()
    j.data.allElementsV2.items = []
    expect(expectOk(parseCosmosSavesPage(j)).nextCursor).toBeNull()
  })

  it('cosmosOriginal: only the format parameter is removed, and only on cosmos.so', () => {
    expect(cosmosOriginal('https://cdn.cosmos.so/a?format=webp&w=10')).toBe(
      'https://cdn.cosmos.so/a?w=10',
    )
    expect(cosmosOriginal('https://example.com/a?format=webp')).toBe(
      'https://example.com/a?format=webp',
    )
    expect(cosmosOriginal(null)).toBeNull()
  })

  it('unknown shapes → api_changed without exception', () => {
    for (const bad of [null, 1, 'z', [], {}, { data: null }, { data: { allElementsV2: {} } }]) {
      expect(parseCosmosSavesPage(bad)).toMatchObject({ ok: false, error: { code: 'api_changed' } })
    }
  })
})

describe('parseCosmosSavesPage — schema recorded on 2026-10-12', () => {
  // SYNTHETIC fixture whose shape follows the extension's request, validated against the
  // public schema of api.cosmos.so (typed media, `source.author` object, typed tiles).
  it('image, Mux video, animated GIF, website, text tile ignored', () => {
    const r = parse('schema-2026.json')
    expect(r.nextCursor).toBe('Y3Vyc2V1ci0y')
    expect(r.stats).toMatchObject({ entries: 5, parsed: 4, ignored: 1 })
    const [image, video, gif, site] = r.posts
    expect(image!.media.map((m) => m.url)).toEqual([
      'https://cdn.cosmos.so/1a2b3c4d-1111-4b3a-9f8e-7d6c5b4a3001',
      'https://cdn.cosmos.so/1a2b3c4d-2222-4b3a-9f8e-7d6c5b4a3002',
    ])
    expect(image!.author).toEqual({
      id: null,
      name: 'Auteur Source',
      handle: 'auteur.source',
      avatarUrl: null,
    })
    expect(cExtra(image!.extra).ownerId).toBe('8800001')
    expect(video).toMatchObject({ kind: 'video' })
    expect(video!.media[0]).toMatchObject({
      url: 'https://stream.mux.com/syntheticPlayback2/high.mp4',
      posterUrl: 'https://cdn.cosmos.so/1a2b3c4d-3334-4b3a-9f8e-7d6c5b4a3003',
      width: 1080,
      height: 1920,
      gif: false,
    })
    expect(gif!.media[0]).toMatchObject({
      type: 'video',
      url: 'https://cdn.cosmos.so/1a2b3c4d-4444-4b3a-9f8e-7d6c5b4a3004.mp4',
      gif: true,
    })
    expect(site).toMatchObject({ kind: 'url', text: 'Un article de référence' })
    expect(cExtra(site!.extra).linkUrl).toBe('https://example.com/article')
  })
})
