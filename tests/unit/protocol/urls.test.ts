/**
 * WP-05 — `assetUrl` et chaîne de repli `resolveMediaUrls` (PLAN §1.7) : URL `recolt://` conformes
 * au contrat `MediaUrl`, jamais d'http(s), `?v=derive_version`.
 */
import { describe, expect, it } from 'vitest'
import { MediaUrl } from '../../../src/shared/enums'
import {
  assetUrl,
  assetUrlOrNull,
  avatarUrl,
  resolveMediaUrls,
  type MediaUrlSource,
} from '../../../src/main/protocol/urls'

const U = '0d5e1f7a-2b3c-4d5e-8f90-123456789abc'

function media(over: Partial<MediaUrlSource> = {}): MediaUrlSource {
  return {
    media_type: 'image',
    status: 'ok',
    file_rel: `items/0d/${U}.jpg`,
    thumb_rel: `thumbs/0d/${U}.webp`,
    large_rel: `large/0d/${U}.webp`,
    poster_rel: null,
    preview_rel: null,
    display_rel: null,
    legacy_thumb_rel: null,
    derive_version: 2,
    ...over,
  }
}

describe('assetUrl', () => {
  it('construit recolt://<lib>/<rel>?v=<n>', () => {
    expect(assetUrl('default', `thumbs/0d/${U}.webp`, 3)).toBe(
      `recolt://default/thumbs/0d/${U}.webp?v=3`,
    )
    expect(assetUrl('lib-2', `avatars/x/abc.jpg`)).toBe('recolt://lib-2/avatars/x/abc.jpg')
  })

  it('encode chaque segment (espaces, accents) et reste conforme à MediaUrl', () => {
    const url = assetUrl('default', 'spaces/assets/ab/été 1.png', 1)
    expect(url).toBe('recolt://default/spaces/assets/ab/%C3%A9t%C3%A9%201.png?v=1')
    expect(MediaUrl.safeParse(url).success).toBe(true)
  })

  it.each([
    ['racine non servie', 'snapshots/x.db'],
    ['..', 'thumbs/../recolt.db'],
    ['segment vide', 'thumbs//x.webp'],
    ['racine seule', 'thumbs'],
    ['antislash', 'thumbs\\x.webp'],
    ['absolu', '/thumbs/x.webp'],
  ])('refuse %s', (_l, rel) => {
    expect(() => assetUrl('default', rel)).toThrow()
    expect(assetUrlOrNull('default', rel)).toBeNull()
  })

  it('refuse un identifiant de bibliothèque non compatible avec un hôte', () => {
    expect(() => assetUrl('Default', 'thumbs/x.webp')).toThrow()
    expect(() => assetUrl('a.b', 'thumbs/x.webp')).toThrow()
  })
})

describe('resolveMediaUrls', () => {
  const lib = 'default'

  it('image complète : thumb, large, original ; pas de poster ni preview', () => {
    const u = resolveMediaUrls(lib, media())
    expect(u).toEqual({
      thumbUrl: `recolt://default/thumbs/0d/${U}.webp?v=2`,
      largeUrl: `recolt://default/large/0d/${U}.webp?v=2`,
      posterUrl: null,
      previewUrl: null,
      originalUrl: `recolt://default/items/0d/${U}.jpg?v=2`,
    })
  })

  it('repli image : thumb ?? legacyThumb ?? display ?? original', () => {
    const legacy = `thumbs/0d/${U}.legacy.jpg`
    const display = `display/0d/${U}.webp`
    expect(
      resolveMediaUrls(lib, media({ thumb_rel: null, legacy_thumb_rel: legacy })).thumbUrl,
    ).toContain(legacy)
    expect(
      resolveMediaUrls(lib, media({ thumb_rel: null, display_rel: display })).thumbUrl,
    ).toContain(display)
    expect(resolveMediaUrls(lib, media({ thumb_rel: null })).thumbUrl).toContain(
      `items/0d/${U}.jpg`,
    )
  })

  it('repli large : large ?? display, sinon null (le renderer prend l’original)', () => {
    const display = `display/0d/${U}.webp`
    expect(
      resolveMediaUrls(lib, media({ large_rel: null, display_rel: display })).largeUrl,
    ).toContain(display)
    expect(resolveMediaUrls(lib, media({ large_rel: null })).largeUrl).toBeNull()
  })

  it('vidéo : thumb ?? poster ?? null, preview null tant que le dérivé manque', () => {
    const v = media({
      media_type: 'video',
      file_rel: `items/0d/${U}.mp4`,
      thumb_rel: null,
      large_rel: null,
      poster_rel: `posters/0d/${U}.jpg`,
    })
    const u = resolveMediaUrls(lib, v)
    expect(u.thumbUrl).toBe(`recolt://default/posters/0d/${U}.jpg?v=2`)
    expect(u.posterUrl).toBe(u.thumbUrl)
    expect(u.previewUrl).toBeNull()
    expect(u.originalUrl).toBe(`recolt://default/items/0d/${U}.mp4?v=2`)
    expect(resolveMediaUrls(lib, { ...v, poster_rel: null }).thumbUrl).toBeNull()
    expect(resolveMediaUrls(lib, { ...v, preview_rel: `previews/0d/${U}.mp4` }).previewUrl).toBe(
      `recolt://default/previews/0d/${U}.mp4?v=2`,
    )
  })

  it('média distant ou perdu : pas d’original exposé (jamais d’http)', () => {
    const remote = resolveMediaUrls(
      lib,
      media({ status: 'remote', thumb_rel: null, large_rel: null }),
    )
    expect(remote).toEqual({
      thumbUrl: null,
      largeUrl: null,
      posterUrl: null,
      previewUrl: null,
      originalUrl: null,
    })
    expect(resolveMediaUrls(lib, media({ status: 'missing' })).originalUrl).toBeNull()
  })

  it('chemin importé abîmé : null plutôt qu’une URL invalide', () => {
    expect(resolveMediaUrls(lib, media({ thumb_rel: '../x.webp' })).thumbUrl).toContain('items/')
  })

  it('sans média : tout à null', () => {
    expect(resolveMediaUrls(lib, null)).toEqual({
      thumbUrl: null,
      largeUrl: null,
      posterUrl: null,
      previewUrl: null,
      originalUrl: null,
    })
  })

  it('toute URL produite passe MediaUrl et ne contient pas http', () => {
    const all = [
      resolveMediaUrls(lib, media()),
      resolveMediaUrls(lib, media({ media_type: 'video', poster_rel: `posters/0d/${U}.jpg` })),
    ].flatMap((u) => Object.values(u).filter((x): x is string => x !== null))
    for (const url of all) {
      expect(MediaUrl.safeParse(url).success, url).toBe(true)
      expect(url).not.toMatch(/https?:/)
    }
  })
})

describe('avatarUrl', () => {
  it('?v = authors.updated_at ; null → monogramme', () => {
    expect(avatarUrl('default', 'avatars/x/0123456789abcdef.jpg', 1700)).toBe(
      'recolt://default/avatars/x/0123456789abcdef.jpg?v=1700',
    )
    expect(avatarUrl('default', null, 1700)).toBeNull()
  })
})
