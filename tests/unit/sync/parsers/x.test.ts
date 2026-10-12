/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- fixtures JSON mutées en place (copie `structuredClone` typée `any`) */
/**
 * Parseur X sur les fixtures synthétiques et leurs variantes corrompues.
 */
import { describe, expect, it } from 'vitest'
import {
  bestMp4,
  parseXBookmarksPage,
  parseXDate,
  snowflakeMs,
  xAvatar400,
  xPhotoOrig,
  type XPostExtra,
} from '../../../../src/main/sync/parsers'
import { checkInvariants, expectOk, fixture, mutable } from './helpers'

const parse = (name: string) => {
  const r = parseXBookmarksPage(fixture('x', name))
  checkInvariants(r)
  return expectOk(r)
}
const xExtra = (e: unknown) => e as XPostExtra
const OCT_8 = Date.UTC(2026, 9, 8, 12, 0, 0)

describe('parseXBookmarksPage — fixtures', () => {
  it('tweet simple : clé, URL canonique, auteur sans @, avatar 400x400, t.co développé', () => {
    const r = parse('simple.json')
    expect(r.posts).toHaveLength(1)
    const p = r.posts[0]!
    expect(p.sourceKey).toBe('x:1870000000000000001')
    expect(p.externalId).toBe('1870000000000000001')
    expect(p.sourceUrl).toBe('https://x.com/studiolumen/status/1870000000000000001')
    expect(p.kind).toBe('tweet')
    expect(p.author).toEqual({
      id: '9100000001',
      name: 'Studio Lumen',
      handle: 'studiolumen',
      avatarUrl: 'https://pbs.twimg.com/profile_images/9100000001/a1_400x400.jpg',
    })
    expect(p.text).toBe(
      'Une grille modulaire pour les affiches de la saison https://example.com/grille',
    )
    expect(p.postedAt).toBe(OCT_8)
    expect(p.remoteSort).toBe('1889999999999000000')
    expect(p.media).toEqual([])
    expect(p.postMeta).toMatchObject({
      v: 1,
      platform: 'x',
      author: { name: 'Studio Lumen', handle: 'studiolumen' },
      url: p.sourceUrl,
      postedAt: OCT_8,
      media: [],
      quoted: null,
      thread: [],
    })
    expect(r.nextCursor).toBe('Q1VSU09SLWZpbg')
  })

  it('médias multiples : photos ordonnées en name=orig, t.co du média retiré du texte', () => {
    const p = parse('medias-multiples.json').posts[0]!
    expect(p.kind).toBe('image')
    expect(p.text).toBe('Trois essais de lettrage')
    expect(p.media.map((m) => m.url)).toEqual([
      'https://pbs.twimg.com/media/GaLeTtRe1?format=jpg&name=orig',
      'https://pbs.twimg.com/media/GaLeTtRe2?format=jpg&name=orig',
      'https://pbs.twimg.com/media/GaLeTtRe3?format=jpg&name=orig',
    ])
    expect(p.media.map((m) => [m.width, m.height])).toEqual([
      [1600, 2000],
      [1600, 1600],
      [2000, 1200],
    ])
    expect(p.postMeta.media).toHaveLength(3)
    expect(p.postMeta.media.every((m) => m.mediaUuid === null && m.type === 'image')).toBe(true)
  })

  it('tweet cité (enveloppé de visibilité) : auteur, texte, URL et médias du cité ; permalien retiré', () => {
    const p = parse('cite.json').posts[0]!
    expect(p.text).toBe('Exactement ce que je cherchais')
    expect(p.postMeta.quoted).toEqual({
      author: {
        name: 'Motion Lab',
        handle: 'motionlab',
        avatarUrl: 'https://pbs.twimg.com/profile_images/9100000003/a3_400x400.jpg',
      },
      text: 'Le poster original',
      url: 'https://x.com/motionlab/status/1870000000000000030',
      media: [
        {
          type: 'image',
          remoteUrl: 'https://pbs.twimg.com/media/QuOtEdImG?format=jpg&name=orig',
          posterUrl: null,
          mediaUuid: null,
        },
      ],
    })
    expect(p.authors.map((a) => a.handle)).toEqual(['studiolumen', 'motionlab'])
    expect(xExtra(p.extra).quotedUnavailable).toBe(false)
  })

  it('fil (réponse à soi-même) : lien de réponse exposé, thread vide', () => {
    const p = parse('fil.json').posts[0]!
    expect(xExtra(p.extra)).toMatchObject({
      selfReply: true,
      inReplyToId: '1870000000000000040',
      inReplyToHandle: 'typoatelier',
      conversationId: '1870000000000000040',
    })
    expect(p.postMeta.thread).toEqual([])
    expect(p.text).toBe('Suite du fil : la version finale du logo.')
  })

  it('note_tweet : le texte long remplace full_text tronqué', () => {
    const p = parse('note-tweet.json').posts[0]!
    expect(p.text?.endsWith('Fin.')).toBe(true)
    expect(p.text!.length).toBeGreaterThan(280)
    expect(p.text).not.toContain('…')
    expect(xExtra(p.extra).noteTweet).toBe(true)
  })

  it('TweetWithVisibilityResults : déballé', () => {
    const p = parse('visibilite.json').posts[0]!
    expect(p.sourceKey).toBe('x:1870000000000000006')
    expect(p.text).toBe('Publication avec limite de visibilité.')
  })

  it('tombstone et TweetUnavailable : isolés et comptés, la page continue et garde son curseur', () => {
    const r = parse('tombstone.json')
    expect(r.posts.map((p) => p.sourceKey)).toEqual(['x:1870000000000000001'])
    expect(r.stats).toMatchObject({ entries: 3, parsed: 1, unavailable: 2, malformed: 0 })
    expect(r.issues.map((i) => i.reason)).toEqual(['TweetTombstone', 'TweetUnavailable'])
    expect(r.nextCursor).toBe('Q1VSU09SLWZpbg')
    expect(r.posts[0]!.position).toBe(0)
  })

  it('vidéo : meilleur mp4 (variantes non triées), GIF sans durée, HLS seul signalé', () => {
    const [video, gif, hls] = parse('video.json').posts
    expect(video!.kind).toBe('video')
    expect(video!.media[0]).toEqual({
      type: 'video',
      url: 'https://video.twimg.com/ext_tw_video/1880000000000000007/pu/vid/avc1/1280x720/high.mp4',
      fallbackUrl: null,
      hlsUrl: 'https://video.twimg.com/ext_tw_video/1880000000000000007/pu/pl/playlist.m3u8',
      hlsOnly: false,
      posterUrl: 'https://pbs.twimg.com/ext_tw_video_thumb/1880000000000000007/pu/img/poster.jpg',
      width: 1280,
      height: 720,
      durationMs: 14_500,
      gif: false,
    })
    expect(video!.text).toBe('Animation de 15 secondes')
    expect(gif!.media[0]).toMatchObject({ gif: true, durationMs: null })
    expect(gif!.media[0]!.url).toMatch(/high\.mp4$/)
    expect(hls!.media[0]).toMatchObject({ url: null, hlsOnly: true })
    expect(hls!.media[0]!.hlsUrl).toMatch(/playlist\.m3u8$/)
    expect(hls!.postMeta.media[0]!.remoteUrl).toMatch(/playlist\.m3u8$/)
    expect(hls!.postMeta.media[0]!.posterUrl).toMatch(/poster\.jpg$/)
  })

  it('repost en favori : contenu et clé de l’original, reposteur conservé', () => {
    const p = parse('retweet.json').posts[0]!
    expect(p.sourceKey).toBe('x:1870000000000000100')
    expect(p.sourceUrl).toBe('https://x.com/typoatelier/status/1870000000000000100')
    expect(p.author?.handle).toBe('typoatelier')
    expect(p.text).toBe('Le texte original du repost')
    expect(p.kind).toBe('image')
    expect(xExtra(p.extra).retweetedBy?.handle).toBe('studiolumen')
    expect(xExtra(p.extra).retweetId).toBe('1870000000000000010')
    expect(p.authors.map((a) => a.handle)).toEqual(['typoatelier', 'studiolumen'])
  })

  it('pagination : 20 publications dans l’ordre, positions et sortIndex décroissants, curseur', () => {
    const r = parse('curseur-page1.json')
    expect(r.posts).toHaveLength(20)
    expect(r.nextCursor).toBe('Q1VSU09SLXBhZ2Uy')
    const sorts = r.posts.map((p) => BigInt(p.remoteSort!))
    for (let i = 1; i < sorts.length; i++) expect(sorts[i]! < sorts[i - 1]!).toBe(true)
    expect(r.posts.filter((p) => p.kind === 'tweet')).toHaveLength(5)
    expect(r.posts.filter((p) => p.kind === 'image')).toHaveLength(15)
  })

  it('dernière page (curseurs seuls, aucun tweet) : nextCursor = null', () => {
    const r = parse('curseur-fin.json')
    expect(r.posts).toEqual([])
    expect(r.nextCursor).toBeNull()
    expect(r.stats.entries).toBe(0)
  })

  it('dossier (bookmark_collection_timeline)', () => {
    const r = parse('dossier.json')
    expect(r.posts.map((p) => p.sourceKey)).toEqual(['x:1870000000000000001'])
    expect(r.nextCursor).toBe('Q1VSU09SLWRvc3M')
  })

  it('erreur features (336) : api_changed et liste des features manquantes', () => {
    const r = parseXBookmarksPage(fixture('x', 'erreur-features.json'))
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: 'api_changed',
        reason: 'features_missing',
        missingFeatures: [
          'graphql_timeline_v2_bookmark_timeline',
          'rweb_tipjar_consumption_enabled',
        ],
      },
    })
  })

  it('erreur 88 : rate_limited', () => {
    expect(parseXBookmarksPage(fixture('x', 'erreur-limite.json'))).toMatchObject({
      ok: false,
      error: { code: 'rate_limited' },
    })
  })
})

describe('parseXBookmarksPage — robustesse', () => {
  it('une entrée corrompue est isolée, les 19 autres et le curseur restent', () => {
    const j = mutable('x', 'curseur-page1.json')
    const entries = j.data.bookmark_timeline_v2.timeline.instructions[0].entries
    entries[3].content.itemContent.tweet_results.result = 42
    delete entries[7].content.itemContent.tweet_results.result.legacy
    entries[9].content.itemContent.tweet_results.result.rest_id = 'pas-un-id'
    delete entries[9].content.itemContent.tweet_results.result.legacy.id_str
    const r = expectOk(parseXBookmarksPage(j))
    checkInvariants(r)
    expect(r.posts).toHaveLength(17)
    expect(r.stats.malformed).toBe(3)
    expect(r.issues.map((i) => i.index)).toEqual([3, 7, 9])
    expect(r.nextCursor).toBe('Q1VSU09SLXBhZ2Uy')
  })

  it('média sans URL : écarté et compté, la publication reste', () => {
    const j = mutable('x', 'medias-multiples.json')
    const t =
      j.data.bookmark_timeline_v2.timeline.instructions[0].entries[0].content.itemContent
        .tweet_results.result
    delete t.legacy.extended_entities.media[1].media_url_https
    t.legacy.extended_entities.media[2].media_url_https = 'javascript:alert(1)'
    const r = expectOk(parseXBookmarksPage(j))
    checkInvariants(r)
    expect(r.posts[0]!.media).toHaveLength(1)
    expect(r.stats.mediaDropped).toBe(2)
  })

  it('structure auteur ancienne (legacy seul) et date absente (repli snowflake)', () => {
    const j = mutable('x', 'simple.json')
    const t =
      j.data.bookmark_timeline_v2.timeline.instructions[0].entries[0].content.itemContent
        .tweet_results.result
    const u = t.core.user_results.result
    delete u.core
    delete u.avatar
    u.legacy.profile_image_url_https = 'https://pbs.twimg.com/profile_images/1/abc_bigger.png'
    delete t.legacy.created_at
    t.rest_id = '1849000000000000000'
    const p = expectOk(parseXBookmarksPage(j)).posts[0]!
    expect(p.author).toMatchObject({ name: 'Studio Lumen', handle: 'studiolumen' })
    expect(p.author!.avatarUrl).toBe('https://pbs.twimg.com/profile_images/1/abc_400x400.png')
    expect(p.postedAt).toBe(snowflakeMs('1849000000000000000'))
    expect(p.sourceKey).toBe('x:1849000000000000000')
  })

  it('auteur indisponible : URL canonique en /i/status/', () => {
    const j = mutable('x', 'simple.json')
    const t =
      j.data.bookmark_timeline_v2.timeline.instructions[0].entries[0].content.itemContent
        .tweet_results.result
    t.core.user_results.result = { __typename: 'UserUnavailable' }
    const p = expectOk(parseXBookmarksPage(j)).posts[0]!
    expect(p.author).toBeNull()
    expect(p.postMeta.author).toBeNull()
    expect(p.sourceUrl).toBe('https://x.com/i/status/1870000000000000001')
  })

  it('mentions de réponse en tête retirées, entités HTML décodées', () => {
    const j = mutable('x', 'simple.json')
    const t =
      j.data.bookmark_timeline_v2.timeline.instructions[0].entries[0].content.itemContent
        .tweet_results.result
    t.legacy.full_text = '@motionlab @typoatelier Oui &amp; non &lt;3'
    t.legacy.display_text_range = [24, 43]
    expect(expectOk(parseXBookmarksPage(j)).posts[0]!.text).toBe('Oui & non <3')
  })

  it('tweet cité supprimé : quoted = null, signalé', () => {
    const j = mutable('x', 'cite.json')
    const t =
      j.data.bookmark_timeline_v2.timeline.instructions[0].entries[0].content.itemContent
        .tweet_results.result
    t.quoted_status_result.result = { __typename: 'TweetTombstone' }
    const p = expectOk(parseXBookmarksPage(j)).posts[0]!
    expect(p.postMeta.quoted).toBeNull()
    expect((p.extra as XPostExtra).quotedUnavailable).toBe(true)
  })

  it('curseur porté par TimelineReplaceEntry (pages suivantes) et module de conversation', () => {
    const page = mutable('x', 'simple.json')
    const entry = page.data.bookmark_timeline_v2.timeline.instructions[0].entries[0]
    const moduleEntry = {
      entryId: 'conversationthread-1',
      sortIndex: '1',
      content: {
        entryType: 'TimelineTimelineModule',
        items: [
          {
            entryId: 'conversationthread-1-tweet-a',
            item: {
              itemContent: mutable('x', 'video.json').data.bookmark_timeline_v2.timeline
                .instructions[0].entries[0].content.itemContent,
            },
          },
        ],
      },
    }
    page.data.bookmark_timeline_v2.timeline.instructions = [
      { type: 'TimelineAddEntries', entries: [entry, moduleEntry] },
      {
        type: 'TimelineReplaceEntry',
        entry_id_to_replace: 'cursor-bottom-0',
        entry: {
          entryId: 'cursor-bottom-0',
          sortIndex: '0',
          content: {
            entryType: 'TimelineTimelineCursor',
            value: 'UkVQTEFDRQ',
            cursorType: 'Bottom',
          },
        },
      },
    ]
    const r = expectOk(parseXBookmarksPage(page))
    checkInvariants(r)
    expect(r.posts.map((p) => p.sourceKey)).toEqual([
      'x:1870000000000000001',
      'x:1870000000000000007',
    ])
    expect(r.nextCursor).toBe('UkVQTEFDRQ')
  })

  it('curseur identique à celui demandé : fin de pagination (pas de boucle)', () => {
    const j = fixture('x', 'curseur-page1.json')
    expect(
      expectOk(parseXBookmarksPage(j, { requestCursor: 'Q1VSU09SLXBhZ2Uy' })).nextCursor,
    ).toBeNull()
    expect(expectOk(parseXBookmarksPage(j, { requestCursor: 'autre' })).nextCursor).toBe(
      'Q1VSU09SLXBhZ2Uy',
    )
  })

  it('doublon dans la page : gardé une fois', () => {
    const j = mutable('x', 'simple.json')
    const ins = j.data.bookmark_timeline_v2.timeline.instructions[0]
    ins.entries.unshift(structuredClone(ins.entries[0]))
    const r = expectOk(parseXBookmarksPage(j))
    checkInvariants(r)
    expect(r.posts).toHaveLength(1)
    expect(r.stats.ignored).toBe(1)
  })

  it('chaîne JSON acceptée ; formes inconnues → erreur api_changed, sans exception', () => {
    expect(
      expectOk(parseXBookmarksPage(JSON.stringify(fixture('x', 'simple.json')))).posts,
    ).toHaveLength(1)
    for (const bad of [
      null,
      undefined,
      42,
      'pas du json',
      [],
      {},
      { data: {} },
      { data: { bookmark_timeline_v2: { timeline: {} } } },
    ]) {
      expect(parseXBookmarksPage(bad)).toMatchObject({ ok: false, error: { code: 'api_changed' } })
    }
    expect(parseXBookmarksPage({ errors: [{ code: 353, message: 'CSRF' }] })).toMatchObject({
      ok: false,
      error: { code: 'auth_required' },
    })
  })
})

describe('outils X', () => {
  it('parseXDate', () => {
    expect(parseXDate('Wed Oct 08 12:00:00 +0000 2026')).toBe(OCT_8)
    expect(parseXDate('Wed Oct 08 14:00:00 +0200 2026')).toBe(OCT_8)
    expect(parseXDate('n’importe quoi')).toBeNull()
    expect(parseXDate(12)).toBeNull()
  })

  it('xAvatar400 et xPhotoOrig', () => {
    expect(xAvatar400('https://pbs.twimg.com/profile_images/1/a_normal.jpg')).toBe(
      'https://pbs.twimg.com/profile_images/1/a_400x400.jpg',
    )
    expect(xAvatar400('https://pbs.twimg.com/profile_images/1/a_mini.jpg')).toBe(
      'https://pbs.twimg.com/profile_images/1/a_400x400.jpg',
    )
    expect(
      xAvatar400('https://abs.twimg.com/sticky/default_profile_images/default_profile.png'),
    ).toBe('https://abs.twimg.com/sticky/default_profile_images/default_profile.png')
    expect(xPhotoOrig('https://pbs.twimg.com/media/AbC.png')).toBe(
      'https://pbs.twimg.com/media/AbC?format=png&name=orig',
    )
    expect(xPhotoOrig('https://pbs.twimg.com/media/AbC?format=jpg&name=small')).toBe(
      'https://pbs.twimg.com/media/AbC?format=jpg&name=orig',
    )
  })

  it('bestMp4 : débit puis résolution, ignore HLS et URL non https', () => {
    expect(
      bestMp4([
        { content_type: 'video/mp4', url: 'https://v.example/vid/avc1/320x180/a.mp4' },
        { content_type: 'video/mp4', url: 'https://v.example/vid/avc1/1280x720/b.mp4' },
        { content_type: 'application/x-mpegURL', url: 'https://v.example/p.m3u8' },
        { content_type: 'video/mp4', bitrate: 9e9, url: 'http://v.example/c.mp4' },
      ]),
    ).toBe('https://v.example/vid/avc1/1280x720/b.mp4')
    expect(bestMp4(undefined)).toBeNull()
  })
})

describe('parseXBookmarksPage — client x-web (bookmarksQuery)', () => {
  // Fixture SYNTHÉTIQUE dont la forme suit l'AST Relay public de `bookmarksQuery` (relevé du
  // 2026-10-12 : `entry_id`, `sort_index`, `content.content.tweet_results`, `details`,
  // `media_entities2`, `url_entities`, `quoted_tweet_results`, `legacy.retweeted_status_results`).
  it('entrées, curseur, texte, médias, réponse, citation, repost, note et tombstone', () => {
    const r = parse('xweb-page-1.json')
    expect(r.nextCursor).toBe('WEVXRUItc3VpdGU')
    expect(r.stats).toMatchObject({ entries: 6, parsed: 5, unavailable: 1 })
    const [photos, video, reply, repost, note] = r.posts
    expect(photos).toMatchObject({
      externalId: '1870000000000000101',
      kind: 'image',
      sourceUrl: 'https://x.com/studiolumen/status/1870000000000000101',
      remoteSort: '1889999999999000101',
      postedAt: OCT_8,
      text: 'Deux affiches de la saison https://example.com/affiches',
    })
    expect(photos!.author).toEqual({
      id: '9100000001',
      name: 'Studio Lumen',
      handle: 'studiolumen',
      avatarUrl: 'https://pbs.twimg.com/profile_images/9100000001/a1_400x400.jpg',
    })
    expect(photos!.media.map((m) => [m.url, m.width, m.height])).toEqual([
      ['https://pbs.twimg.com/media/XwEbPhOtO1?format=jpg&name=orig', 1600, 2000],
      ['https://pbs.twimg.com/media/XwEbPhOtO2?format=png&name=orig', 1200, 1200],
    ])
    expect(video).toMatchObject({ kind: 'video', text: 'Making-of du tournage' })
    expect(video!.media[0]).toMatchObject({
      url: 'https://video.twimg.com/amplify_video/3300000000000000201/vid/avc1/1280x720/haute.mp4',
      hlsUrl: 'https://video.twimg.com/amplify_video/3300000000000000201/pl/playlist.m3u8',
      posterUrl: 'https://pbs.twimg.com/amplify_video_thumb/3300000000000000201/img/PoStEr.jpg',
      durationMs: 12500,
    })
    expect(reply!.text).toBe('Suite du fil, avec la version finale')
    expect(xExtra(reply!.extra)).toMatchObject({
      inReplyToId: '1870000000000000101',
      inReplyToHandle: 'studiolumen',
      selfReply: true,
    })
    expect(reply!.postMeta.quoted).toMatchObject({
      url: 'https://x.com/ateliernord/status/1870000000000000090',
      text: 'La grille d’origine',
    })
    expect(repost).toMatchObject({ externalId: '1870000000000000080', text: 'Palette d’automne' })
    expect(xExtra(repost!.extra).retweetedBy?.handle).toBe('studiolumen')
    expect(note).toMatchObject({ text: 'Note longue complète, avec tous ses paragraphes.' })
    expect(xExtra(note!.extra).noteTweet).toBe(true)
  })

  it('page sans tweet → curseur nul ; sponsorisé et module de conversation x-web', () => {
    expect(parse('xweb-page-fin.json')).toMatchObject({ posts: [], nextCursor: null })
    const page = mutable('x', 'xweb-page-1.json')
    const entries = page.data.bookmark_timeline_v2.timeline.instructions[0].entries
    entries[1].content.content.promoted_metadata = { impression_id: 'pub' }
    const tweet = entries[0]
    entries.splice(0, 1, {
      entry_id: 'conversation-1',
      sort_index: '1889999999999000101',
      content: {
        __typename: 'TimelineTimelineModule',
        items: [{ entry_id: 'conversation-1-tweet-1', item: { content: tweet.content.content } }],
      },
    })
    const r = expectOk(parseXBookmarksPage(page))
    expect(r.posts.map((p) => p.externalId)).toContain('1870000000000000101')
    expect(r.posts.map((p) => p.externalId)).not.toContain('1870000000000000102')
    expect(r.issues.some((i) => i.reason === 'contenu sponsorisé')).toBe(true)
  })
})
