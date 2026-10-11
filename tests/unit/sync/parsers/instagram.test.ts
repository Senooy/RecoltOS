/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- fixtures JSON mutées en place (copie `structuredClone` typée `any`) */
/**
 * Parseur Instagram (WP-55, SYNC §4.2) sur les fixtures synthétiques de WP-50.
 */
import { describe, expect, it } from 'vitest'
import {
  igExpiry,
  parseInstagramMediaInfo,
  parseInstagramSavedPage,
  type InstagramPostExtra,
} from '../../../../src/main/sync/parsers'
import { checkInvariants, expectOk, fixture, mutable } from './helpers'

const parse = (name: string) => {
  const r = parseInstagramSavedPage(fixture('instagram', name))
  checkInvariants(r)
  return expectOk(r)
}
const igExtra = (e: unknown) => e as InstagramPostExtra
const OE_MS = 0x6a7b8c9d * 1000

describe('parseInstagramSavedPage — fixtures', () => {
  it('image : clé ig:<code>, URL /p/<code>/, auteur sans @, légende, date, collections', () => {
    const r = parse('image.json')
    expect(r.nextCursor).toBeNull()
    const p = r.posts[0]!
    expect(p.sourceKey).toBe('ig:DSyNtH00001')
    expect(p.sourceUrl).toBe('https://www.instagram.com/p/DSyNtH00001/')
    expect(p.kind).toBe('image')
    expect(p.author).toMatchObject({
      id: '5100000001',
      name: 'Atelier Papier',
      handle: 'atelier.papier',
    })
    expect(p.author!.avatarUrl).toMatch(/^https:\/\/scontent.+profil5100000001\.jpg\?/)
    expect(p.text).toBe('Légende de la publication 1 #affiche')
    expect(p.postedAt).toBe((1_759_900_000 + 60) * 1000)
    expect(p.media).toHaveLength(1)
    expect(p.media[0]!.url).toMatch(/img1_1080\.jpg/)
    expect(p.media[0]).toMatchObject({ width: 1080, height: 1350 })
    expect(igExtra(p.extra)).toEqual({
      platform: 'instagram',
      pk: '3700000000000000001',
      igCollections: [],
      productType: 'feed',
      mediaType: 1,
      expiresAt: OE_MS,
    })
    expect(p.postMeta).toMatchObject({ platform: 'instagram', url: p.sourceUrl, quoted: null })
  })

  it('reel : vidéo à la plus grande variante, poster, durée, URL en /p/', () => {
    const p = parse('reel.json').posts[0]!
    expect(p.kind).toBe('video')
    expect(p.sourceUrl).toBe('https://www.instagram.com/p/DSyNtH00002/')
    expect(p.media[0]!.url).toMatch(/reel2_720\.mp4/)
    expect(p.media[0]!.posterUrl).toMatch(/img2_1080\.jpg/)
    expect(p.media[0]!.durationMs).toBe(21_400)
    expect(igExtra(p.extra)).toMatchObject({
      productType: 'clips',
      mediaType: 2,
      igCollections: ['17900000000000001'],
    })
  })

  it('carrousel : 10 médias ordonnés, la vidéo (index 3) avec poster, kind du 1er', () => {
    const p = parse('carrousel.json').posts[0]!
    expect(p.kind).toBe('image')
    expect(p.media).toHaveLength(10)
    expect(p.media.map((m) => m.type)).toEqual([
      'image',
      'image',
      'image',
      'video',
      'image',
      'image',
      'image',
      'image',
      'image',
      'image',
    ])
    p.media.forEach((m, i) => {
      if (i === 3) {
        expect(m.url).toMatch(/car3_3\.mp4/)
        expect(m.posterUrl).toMatch(/car3_3_poster\.jpg/)
      } else expect(m.url).toMatch(new RegExp(`car3_${i}\\.jpg`))
    })
    expect(p.postMeta.media).toHaveLength(10)
    expect(p.text).toBe('Carrousel de 10 images')
    expect(igExtra(p.extra).mediaType).toBe(8)
  })

  it('pagination : 12 publications et next_max_id ; dernière page et page vide → null', () => {
    const r = parse('page-1.json')
    expect(r.posts).toHaveLength(12)
    expect(r.nextCursor).toBe('QVFDTXN5bnRoZXRpcXVlLXBhZ2Uy')
    expect(r.posts.filter((p) => p.kind === 'video')).toHaveLength(2)
    expect(parse('page-fin.json')).toMatchObject({ nextCursor: null, stats: { parsed: 2 } })
    expect(parse('vide.json')).toMatchObject({ posts: [], nextCursor: null, stats: { entries: 0 } })
  })

  it('checkpoint et connexion → auth_required ; « Please wait » → rate_limited', () => {
    expect(parseInstagramSavedPage(fixture('instagram', 'checkpoint.json'))).toMatchObject({
      ok: false,
      error: { code: 'auth_required', reason: 'checkpoint_required' },
    })
    expect(parseInstagramSavedPage(fixture('instagram', 'connexion.json'))).toMatchObject({
      ok: false,
      error: { code: 'auth_required', reason: 'login_required' },
    })
    expect(parseInstagramSavedPage(fixture('instagram', 'limite.json'))).toMatchObject({
      ok: false,
      error: { code: 'rate_limited' },
    })
  })

  it('media/<pk>/info : items sans enveloppe { media }, curseur toujours null', () => {
    const r = parseInstagramMediaInfo(fixture('instagram', 'media-info.json'))
    checkInvariants(r)
    const ok = expectOk(r)
    expect(ok.nextCursor).toBeNull()
    expect(ok.posts[0]!.sourceKey).toBe('ig:DSyNtH00003')
    expect(ok.posts[0]!.media).toHaveLength(10)
  })
})

describe('parseInstagramSavedPage — robustesse', () => {
  it('élément de carrousel cassé : écarté et compté, les 9 autres restent dans l’ordre', () => {
    const j = mutable('instagram', 'carrousel.json')
    j.items[0].media.carousel_media[5].image_versions2.candidates = []
    const r = expectOk(parseInstagramSavedPage(j))
    checkInvariants(r)
    expect(r.posts[0]!.media).toHaveLength(9)
    expect(r.stats.mediaDropped).toBe(1)
  })

  it('publication sans code ou sans média : isolée, les autres et le curseur restent', () => {
    const j = mutable('instagram', 'page-1.json')
    delete j.items[2].media.code
    j.items[4].media.video_versions = []
    j.items[4].media.image_versions2 = null
    j.items[6] = { pas: 'un média' }
    const r = expectOk(parseInstagramSavedPage(j))
    checkInvariants(r)
    expect(r.posts).toHaveLength(9)
    expect(r.stats.malformed).toBe(3)
    expect(r.nextCursor).toBe('QVFDTXN5bnRoZXRpcXVlLXBhZ2Uy')
  })

  it('more_available sans next_max_id → fin ; légende ou auteur absents tolérés', () => {
    const j = mutable('instagram', 'image.json')
    j.more_available = true
    j.items[0].media.caption = null
    delete j.items[0].media.user
    const r = expectOk(parseInstagramSavedPage(j))
    checkInvariants(r)
    expect(r.nextCursor).toBeNull()
    expect(r.posts[0]!.text).toBeNull()
    expect(r.posts[0]!.author).toBeNull()
    expect(r.posts[0]!.authors).toEqual([])
  })

  it('adaptateur GraphQL (edges/node, page_info) : même sortie', () => {
    const rest = mutable('instagram', 'page-1.json')
    const gql = {
      data: {
        xdt_api__v1__feed__saved__posts__connection: {
          edges: rest.items.map((i: { media: unknown }) => ({ node: i.media })),
          page_info: { has_next_page: true, end_cursor: 'R1FMLWN1cnNldXI' },
        },
      },
    }
    const r = expectOk(parseInstagramSavedPage(gql))
    checkInvariants(r)
    expect(r.posts.map((p) => p.sourceKey)).toEqual(
      expectOk(parseInstagramSavedPage(rest)).posts.map((p) => p.sourceKey),
    )
    expect(r.nextCursor).toBe('R1FMLWN1cnNldXI')
  })

  it('formes inconnues → api_changed sans exception', () => {
    for (const bad of [null, 'x', 3, [], {}, { status: 'ok' }, { data: { a: 1 } }]) {
      expect(parseInstagramSavedPage(bad)).toMatchObject({
        ok: false,
        error: { code: 'api_changed' },
      })
    }
  })

  it('igExpiry', () => {
    expect(igExpiry('https://a.cdninstagram.com/x.jpg?oe=6A7B8C9D')).toBe(OE_MS)
    expect(igExpiry('https://a.cdninstagram.com/x.jpg')).toBeNull()
    expect(igExpiry(null)).toBeNull()
  })
})
