/**
 * Fixtures de synchronisation SYNTHÉTIQUES (WP-50, ERRATA §G.2 n°3) : formes publiques connues des
 * réponses X (GraphQL `Bookmarks`), Instagram (`feed/saved/posts`, `media/<pk>/info`) et Cosmos
 * (`GetAllElements`, `me`). Aucun contenu réel, aucun cookie ni jeton : identifiants, textes et chemins
 * de médias sont fabriqués ici. Déterministe : `pnpm exec tsx scripts/make-sync-fixtures.mts` réécrit
 * `tests/fixtures/sync/**` à l'identique.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')

// ---------------------------------------------------------------- X (GraphQL Bookmarks)

interface XUser {
  id: string
  name: string
  screen: string
  avatar: string
}

const xUsers: XUser[] = [
  { id: '9100000001', name: 'Studio Lumen', screen: 'studiolumen', avatar: 'a1' },
  { id: '9100000002', name: 'Typo Atelier', screen: 'typoatelier', avatar: 'a2' },
  { id: '9100000003', name: 'Motion Lab', screen: 'motionlab', avatar: 'a3' },
]

function xUserResult(u: XUser) {
  return {
    result: {
      __typename: 'User',
      id: `VXNlcjo${u.id}`,
      rest_id: u.id,
      core: { name: u.name, screen_name: u.screen, created_at: 'Mon Jan 01 10:00:00 +0000 2018' },
      avatar: { image_url: `https://pbs.twimg.com/profile_images/${u.id}/${u.avatar}_normal.jpg` },
      legacy: {
        name: u.name,
        screen_name: u.screen,
        profile_image_url_https: `https://pbs.twimg.com/profile_images/${u.id}/${u.avatar}_normal.jpg`,
        followers_count: 1200,
      },
    },
  }
}

interface XTweetOpts {
  id: string
  user: XUser
  text: string
  createdAt?: string
  urls?: { url: string; expanded: string }[]
  media?: unknown[]
  mediaTco?: string
  quoted?: unknown
  retweeted?: unknown
  note?: string
  replyTo?: { screen: string; statusId: string }
}

function xTweet(o: XTweetOpts) {
  const legacy: Record<string, unknown> = {
    created_at: o.createdAt ?? 'Wed Oct 08 12:00:00 +0000 2026',
    full_text: o.text,
    id_str: o.id,
    conversation_id_str: o.replyTo?.statusId ?? o.id,
    lang: 'fr',
    favorite_count: 12,
    retweet_count: 3,
    bookmarked: true,
    entities: {
      hashtags: [],
      urls: (o.urls ?? []).map((u) => ({
        url: u.url,
        expanded_url: u.expanded,
        display_url: u.expanded.replace(/^https?:\/\//, ''),
        indices: [0, 23],
      })),
      user_mentions: [],
      media: o.media && o.mediaTco ? [{ url: o.mediaTco, type: 'photo' }] : undefined,
    },
  }
  if (o.media) legacy.extended_entities = { media: o.media }
  if (o.replyTo) {
    legacy.in_reply_to_screen_name = o.replyTo.screen
    legacy.in_reply_to_status_id_str = o.replyTo.statusId
  }
  if (o.retweeted) legacy.retweeted_status_result = { result: o.retweeted }
  const tweet: Record<string, unknown> = {
    __typename: 'Tweet',
    rest_id: o.id,
    core: { user_results: xUserResult(o.user) },
    legacy,
    views: { count: '4200', state: 'EnabledWithCount' },
  }
  if (o.quoted) {
    tweet.quoted_status_result = { result: o.quoted }
    legacy.is_quote_status = true
  }
  if (o.note) {
    tweet.note_tweet = { is_expandable: true, note_tweet_results: { result: { text: o.note } } }
  }
  return tweet
}

function xPhoto(key: string, w = 1600, h = 1200, tco = 'https://t.co/m3d1aPh0t0') {
  return {
    type: 'photo',
    id_str: `77${key.replace(/\D/g, '').padEnd(8, '0')}`,
    media_key: `3_${key}`,
    url: tco,
    display_url: 'pic.x.com/m3d1aPh0t0',
    media_url_https: `https://pbs.twimg.com/media/${key}.jpg`,
    original_info: { width: w, height: h },
    sizes: { large: { w, h, resize: 'fit' } },
  }
}

function xVideo(key: string, opts: { gif?: boolean; hlsOnly?: boolean } = {}) {
  const variants = opts.hlsOnly
    ? [
        {
          content_type: 'application/x-mpegURL',
          url: `https://video.twimg.com/ext_tw_video/${key}/pu/pl/playlist.m3u8`,
        },
      ]
    : [
        {
          content_type: 'application/x-mpegURL',
          url: `https://video.twimg.com/ext_tw_video/${key}/pu/pl/playlist.m3u8`,
        },
        {
          bitrate: 832000,
          content_type: 'video/mp4',
          url: `https://video.twimg.com/ext_tw_video/${key}/pu/vid/avc1/640x360/low.mp4`,
        },
        {
          bitrate: 2176000,
          content_type: 'video/mp4',
          url: `https://video.twimg.com/ext_tw_video/${key}/pu/vid/avc1/1280x720/high.mp4`,
        },
        {
          bitrate: 256000,
          content_type: 'video/mp4',
          url: `https://video.twimg.com/ext_tw_video/${key}/pu/vid/avc1/320x180/tiny.mp4`,
        },
      ]
  return {
    type: opts.gif ? 'animated_gif' : 'video',
    id_str: `88${key.replace(/\D/g, '').padEnd(8, '0')}`,
    media_key: `7_${key}`,
    url: 'https://t.co/v1d3oT0c0x',
    media_url_https: `https://pbs.twimg.com/ext_tw_video_thumb/${key}/pu/img/poster.jpg`,
    original_info: { width: 1280, height: 720 },
    video_info: {
      aspect_ratio: [16, 9],
      duration_millis: opts.gif ? undefined : 14_500,
      variants,
    },
  }
}

function xEntry(tweetResult: unknown, sortIndex: string, id: string) {
  return {
    entryId: `tweet-${id}`,
    sortIndex,
    content: {
      entryType: 'TimelineTimelineItem',
      __typename: 'TimelineTimelineItem',
      itemContent: {
        itemType: 'TimelineTweet',
        __typename: 'TimelineTweet',
        tweet_results: { result: tweetResult },
        tweetDisplayType: 'Tweet',
      },
    },
  }
}

function xCursor(kind: 'top' | 'bottom', value: string) {
  return {
    entryId: `cursor-${kind}-${kind === 'top' ? '1999999999999999999' : '1000000000000000000'}`,
    sortIndex: kind === 'top' ? '1999999999999999999' : '1000000000000000000',
    content: {
      entryType: 'TimelineTimelineCursor',
      __typename: 'TimelineTimelineCursor',
      value,
      cursorType: kind === 'top' ? 'Top' : 'Bottom',
    },
  }
}

function xPage(entries: unknown[], bottom: string | null = 'Q1VSU09SLWZpbg') {
  const all = [...entries, xCursor('top', 'Q1VSU09SLWhhdXQ')]
  if (bottom) all.push(xCursor('bottom', bottom))
  return {
    data: {
      bookmark_timeline_v2: {
        timeline: {
          instructions: [{ type: 'TimelineAddEntries', entries: all }],
          responseObjects: { feedbackActions: [] },
        },
      },
    },
  }
}

/** sortIndex : snowflake croissant (plus récent = plus grand). */
const sortIndex = (n: number) => String(1_890_000_000_000_000_000n - BigInt(n) * 1_000_000n)
const tweetId = (n: number) => String(1_870_000_000_000_000_000n + BigInt(n))

export function xFixtures(): Record<string, unknown> {
  const [u1, u2, u3] = xUsers as [XUser, XUser, XUser]
  const simple = xTweet({
    id: tweetId(1),
    user: u1,
    text: 'Une grille modulaire pour les affiches de la saison https://t.co/l1enArt1cl',
    urls: [{ url: 'https://t.co/l1enArt1cl', expanded: 'https://example.com/grille' }],
  })
  const multi = xTweet({
    id: tweetId(2),
    user: u2,
    text: 'Trois essais de lettrage https://t.co/m3d1aPh0t0',
    media: [
      xPhoto('GaLeTtRe1', 1600, 2000),
      xPhoto('GaLeTtRe2', 1600, 1600),
      xPhoto('GaLeTtRe3', 2000, 1200),
    ],
    mediaTco: 'https://t.co/m3d1aPh0t0',
  })
  const quotedInner = xTweet({
    id: tweetId(30),
    user: u3,
    text: 'Le poster original https://t.co/m3d1aPh0t0',
    media: [xPhoto('QuOtEdImG')],
    mediaTco: 'https://t.co/m3d1aPh0t0',
  })
  const quote = xTweet({
    id: tweetId(3),
    user: u1,
    text: 'Exactement ce que je cherchais https://t.co/qu0teL1nk0',
    urls: [
      { url: 'https://t.co/qu0teL1nk0', expanded: `https://x.com/motionlab/status/${tweetId(30)}` },
    ],
    quoted: { __typename: 'TweetWithVisibilityResults', tweet: quotedInner },
  })
  const thread = xTweet({
    id: tweetId(4),
    user: u2,
    text: 'Suite du fil : la version finale du logo.',
    replyTo: { screen: u2.screen, statusId: tweetId(40) },
  })
  const longText = `${'Un long texte de note pour tester la limite des 280 caractères. '.repeat(8)}Fin.`
  const note = xTweet({
    id: tweetId(5),
    user: u3,
    text: `${longText.slice(0, 270)}…`,
    note: longText,
  })
  const visibility = {
    __typename: 'TweetWithVisibilityResults',
    tweet: xTweet({ id: tweetId(6), user: u1, text: 'Publication avec limite de visibilité.' }),
    limitedActionResults: { limited_actions: [{ action: 'Reply' }] },
  }
  const tombstone = {
    __typename: 'TweetTombstone',
    tombstone: {
      __typename: 'TextTombstone',
      text: { text: 'Cette publication est indisponible.' },
    },
  }
  const unavailable = { __typename: 'TweetUnavailable', reason: 'Suspended' }
  const video = xTweet({
    id: tweetId(7),
    user: u3,
    text: 'Animation de 15 secondes https://t.co/v1d3oT0c0x',
    media: [xVideo('1880000000000000007')],
    mediaTco: 'https://t.co/v1d3oT0c0x',
  })
  const gif = xTweet({
    id: tweetId(8),
    user: u3,
    text: 'Boucle https://t.co/v1d3oT0c0x',
    media: [xVideo('1880000000000000008', { gif: true })],
    mediaTco: 'https://t.co/v1d3oT0c0x',
  })
  const hlsOnly = xTweet({
    id: tweetId(9),
    user: u3,
    text: 'Vidéo sans mp4',
    media: [xVideo('1880000000000000009', { hlsOnly: true })],
  })
  const retweetInner = xTweet({
    id: tweetId(100),
    user: u2,
    text: 'Le texte original du repost https://t.co/m3d1aPh0t0',
    media: [xPhoto('ReTwEeT01')],
    mediaTco: 'https://t.co/m3d1aPh0t0',
  })
  const retweet = xTweet({
    id: tweetId(10),
    user: u1,
    text: `RT @${u2.screen}: Le texte original du repost`,
    retweeted: retweetInner,
  })

  const page20 = Array.from({ length: 20 }, (_, i) => {
    const n = 200 + i
    const u = xUsers[i % 3]!
    const t =
      i % 4 === 0
        ? xTweet({ id: tweetId(n), user: u, text: `Publication texte numéro ${i + 1}` })
        : xTweet({
            id: tweetId(n),
            user: u,
            text: `Image numéro ${i + 1} https://t.co/m3d1aPh0t0`,
            media: [xPhoto(`PaGe${String(i).padStart(3, '0')}`, 1200, 1500)],
            mediaTco: 'https://t.co/m3d1aPh0t0',
          })
    return xEntry(t, sortIndex(n), tweetId(n))
  })

  return {
    'simple.json': xPage([xEntry(simple, sortIndex(1), tweetId(1))]),
    'medias-multiples.json': xPage([xEntry(multi, sortIndex(2), tweetId(2))]),
    'cite.json': xPage([xEntry(quote, sortIndex(3), tweetId(3))]),
    'fil.json': xPage([xEntry(thread, sortIndex(4), tweetId(4))]),
    'note-tweet.json': xPage([xEntry(note, sortIndex(5), tweetId(5))]),
    'visibilite.json': xPage([xEntry(visibility, sortIndex(6), tweetId(6))]),
    'tombstone.json': xPage([
      xEntry(tombstone, sortIndex(60), tweetId(60)),
      xEntry(unavailable, sortIndex(61), tweetId(61)),
      xEntry(simple, sortIndex(1), tweetId(1)),
    ]),
    'video.json': xPage([
      xEntry(video, sortIndex(7), tweetId(7)),
      xEntry(gif, sortIndex(8), tweetId(8)),
      xEntry(hlsOnly, sortIndex(9), tweetId(9)),
    ]),
    'retweet.json': xPage([xEntry(retweet, sortIndex(10), tweetId(10))]),
    'curseur-page1.json': xPage(page20, 'Q1VSU09SLXBhZ2Uy'),
    'curseur-fin.json': xPage([], 'Q1VSU09SLWZpbmFs'),
    'dossier.json': {
      data: {
        bookmark_collection_timeline: {
          timeline: {
            instructions: [
              {
                type: 'TimelineAddEntries',
                entries: [
                  xEntry(simple, sortIndex(1), tweetId(1)),
                  xCursor('bottom', 'Q1VSU09SLWRvc3M'),
                ],
              },
            ],
          },
        },
      },
    },
    'erreur-features.json': {
      errors: [
        {
          message:
            'The following features cannot be null: graphql_timeline_v2_bookmark_timeline, rweb_tipjar_consumption_enabled',
          extensions: { name: 'BadRequestError', code: 336 },
          code: 336,
        },
      ],
    },
    'erreur-limite.json': { errors: [{ code: 88, message: 'Rate limit exceeded' }] },
  }
}

/** Page d'accueil x.com et bundle web factices (découverte du `queryId` depuis l'arrière-plan). */
export function xBundleFixtures(): Record<string, string> {
  return {
    'accueil.html': `<!doctype html><html><head>
<link rel="preload" as="script" crossorigin="anonymous" href="https://abs.twimg.com/responsive-web/client-web/vendor.f00dcafe.js">
<script type="text/javascript" charset="utf-8" nonce="test" crossorigin="anonymous" src="https://abs.twimg.com/responsive-web/client-web/main.a1b2c3d4.js"></script>
</head><body></body></html>\n`,
    'main.js': `(self.webpackChunk=self.webpackChunk||[]).push([[1],{1:e=>{e.exports={queryId:"TwEeTdEtAiLqUeRy01",operationName:"TweetDetail",operationType:"query",metadata:{featureSwitches:["a"],fieldToggles:[]}}},2:e=>{e.exports={queryId:"BoOkMaRkSqUeRy0001",operationName:"Bookmarks",operationType:"query",metadata:{featureSwitches:["graphql_timeline_v2_bookmark_timeline","responsive_web_graphql_timeline_navigation_enabled","rweb_tipjar_consumption_enabled"],fieldToggles:["withAuxiliaryUserLabels"]}}},3:(e,t,n)=>{const r="AAAAAAAAAAAAAAAAAAAAAFaKeWeBcLiEnToKeNfOrTeStS000000000000000000000000000000000000000000";n.d(t,{t:()=>r})}}]);\n`,
  }
}

// ---------------------------------------------------------------- Instagram (feed/saved/posts)

const igUsers = [
  { pk: '5100000001', username: 'atelier.papier', full: 'Atelier Papier' },
  { pk: '5100000002', username: 'nuit.couleur', full: 'Nuit Couleur' },
]

/** Code court Instagram synthétique (alphabet base64 url). */
const igCode = (n: number) => `DSyNtH${String(n).padStart(5, '0')}`
const igPk = (n: number) => String(3_700_000_000_000_000_000n + BigInt(n))

function igCandidate(path: string, w: number, h: number) {
  return {
    url: `https://scontent-cdg4-1.cdninstagram.com/v/t51.2885-15/${path}.jpg?stp=dst-jpg_e35&_nc_ht=scontent-cdg4-1.cdninstagram.com&oe=6A7B8C9D&_nc_sid=10d13b`,
    width: w,
    height: h,
  }
}

function igUser(i: number) {
  const u = igUsers[i % igUsers.length]!
  return {
    pk: u.pk,
    pk_id: u.pk,
    username: u.username,
    full_name: u.full,
    is_private: false,
    is_verified: false,
    profile_pic_url: `https://scontent-cdg4-1.cdninstagram.com/v/t51.2885-19/profil${u.pk}.jpg?stp=dst-jpg_s150x150&oe=6A7B8C9D`,
  }
}

function igImage(n: number, userIndex = 0) {
  return {
    pk: igPk(n),
    id: `${igPk(n)}_${igUser(userIndex).pk}`,
    code: igCode(n),
    taken_at: 1_759_900_000 + n * 60,
    media_type: 1,
    product_type: 'feed',
    original_width: 1080,
    original_height: 1350,
    image_versions2: {
      candidates: [igCandidate(`img${n}_1080`, 1080, 1350), igCandidate(`img${n}_640`, 640, 800)],
    },
    user: igUser(userIndex),
    caption: { pk: `17${n}`, text: `Légende de la publication ${n} #affiche` },
    saved_collection_ids: n % 2 === 0 ? ['17900000000000001'] : [],
    has_liked: false,
  }
}

function igReel(n: number) {
  return {
    ...igImage(n, 1),
    media_type: 2,
    product_type: 'clips',
    video_duration: 21.4,
    video_versions: [
      {
        type: 101,
        width: 720,
        height: 1280,
        url: `https://scontent-cdg4-1.cdninstagram.com/o1/v/t16/f2/m86/reel${n}_720.mp4?efg=x&oe=6A7B8C9D`,
      },
      {
        type: 102,
        width: 480,
        height: 854,
        url: `https://scontent-cdg4-1.cdninstagram.com/o1/v/t16/f2/m86/reel${n}_480.mp4?efg=x&oe=6A7B8C9D`,
      },
    ],
    caption: { pk: `18${n}`, text: `Reel ${n}` },
  }
}

function igCarousel(n: number, count: number) {
  const base = igImage(n, 0)
  return {
    ...base,
    media_type: 8,
    product_type: 'carousel_container',
    carousel_media_count: count,
    image_versions2: undefined,
    carousel_media: Array.from({ length: count }, (_, i) =>
      i === 3
        ? {
            pk: igPk(n * 100 + i),
            id: `${igPk(n * 100 + i)}_${base.user.pk}`,
            media_type: 2,
            original_width: 1080,
            original_height: 1350,
            image_versions2: { candidates: [igCandidate(`car${n}_${i}_poster`, 1080, 1350)] },
            video_versions: [
              {
                type: 101,
                width: 1080,
                height: 1350,
                url: `https://scontent-cdg4-1.cdninstagram.com/o1/v/t16/f2/m86/car${n}_${i}.mp4?oe=6A7B8C9D`,
              },
            ],
          }
        : {
            pk: igPk(n * 100 + i),
            id: `${igPk(n * 100 + i)}_${base.user.pk}`,
            media_type: 1,
            original_width: 1080,
            original_height: 1350,
            image_versions2: { candidates: [igCandidate(`car${n}_${i}`, 1080, 1350)] },
          },
    ),
    caption: { pk: `19${n}`, text: `Carrousel de ${count} images` },
  }
}

function igPage(items: unknown[], next: string | null) {
  return {
    items: items.map((media) => ({ media })),
    num_results: items.length,
    more_available: next !== null,
    next_max_id: next,
    auto_load_more_enabled: true,
    status: 'ok',
  }
}

export function igFixtures(): Record<string, unknown> {
  return {
    'image.json': igPage([igImage(1)], null),
    'reel.json': igPage([igReel(2)], null),
    'carrousel.json': igPage([igCarousel(3, 10)], null),
    'page-1.json': igPage(
      Array.from({ length: 12 }, (_, i) => (i % 5 === 4 ? igReel(10 + i) : igImage(10 + i, i))),
      'QVFDTXN5bnRoZXRpcXVlLXBhZ2Uy',
    ),
    'page-fin.json': igPage([igImage(40), igImage(41, 1)], null),
    'vide.json': igPage([], null),
    'checkpoint.json': {
      message: 'checkpoint_required',
      checkpoint_url: 'https://www.instagram.com/challenge/',
      lock: true,
      status: 'fail',
    },
    'connexion.json': { message: 'login_required', status: 'fail', require_login: true },
    'limite.json': { message: 'Please wait a few minutes before you try again.', status: 'fail' },
    'media-info.json': { items: [igCarousel(3, 10)], num_results: 1, status: 'ok' },
  }
}

// ---------------------------------------------------------------- Cosmos (GraphQL)

function cosmosElement(n: number, kind: 'image' | 'video' | 'site' | 'texte' | 'multi') {
  const base = {
    id: String(1_400_000_000 + n),
    createdAt: new Date(Date.UTC(2026, 9, 1, 10, 0, 0) - n * 3_600_000).toISOString(),
    shareUrl: `https://www.cosmos.so/e/${1_400_000_000 + n}`,
    ownerId: '8800001',
    generatedCaption: { text: `Description générée ${n}` },
    source: { url: `https://example.com/source/${n}`, author: 'auteur source' },
    media: null as unknown,
    multipleMedia: null as unknown,
    video: null as unknown,
    mux: null as unknown,
    websiteTitle: null as unknown,
    text: null as unknown,
  }
  const img = (k: string) => ({
    url: `https://cdn.cosmos.so/0f0e0d0c-${k}-4b3a-9f8e-7d6c5b4a3${String(n).padStart(3, '0')}?format=webp`,
    width: 1200,
    height: 1500,
  })
  if (kind === 'image') base.media = img('aaaa')
  if (kind === 'multi') {
    base.media = img('bbbb')
    base.multipleMedia = [img('bbbb'), img('cccc'), img('dddd')]
  }
  if (kind === 'video') {
    base.media = img('eeee')
    base.video = { url: `https://cdn.cosmos.so/video-${n}.mp4`, thumbnailUrl: img('eeee').url }
    base.mux = {
      mp4Url: `https://stream.mux.com/syntheticPlayback${n}/high.mp4`,
      downloadableUrl: `https://stream.mux.com/syntheticPlayback${n}/capped-1080p.mp4`,
    }
  }
  if (kind === 'site') {
    base.media = img('ffff')
    base.websiteTitle = `Site de référence ${n}`
    base.source = { url: `https://example.com/site/${n}`, author: '' }
  }
  if (kind === 'texte') base.text = `Une note texte ${n}`
  return base
}

function cosmosPage(items: unknown[], next: string | null) {
  return { data: { allElementsV2: { items, meta: { nextPageCursor: next, count: items.length } } } }
}

export function cosmosFixtures(): Record<string, unknown> {
  return {
    'image.json': cosmosPage([cosmosElement(1, 'image')], null),
    'lien.json': cosmosPage([cosmosElement(2, 'site')], null),
    'video.json': cosmosPage([cosmosElement(3, 'video')], null),
    'texte.json': cosmosPage([cosmosElement(4, 'texte'), cosmosElement(5, 'image')], null),
    'multi.json': cosmosPage([cosmosElement(6, 'multi')], null),
    'page-1.json': cosmosPage(
      Array.from({ length: 8 }, (_, i) => cosmosElement(10 + i, i % 4 === 3 ? 'site' : 'image')),
      'Y29zbW9zLXBhZ2UtMg',
    ),
    'page-fin.json': cosmosPage([cosmosElement(30, 'image')], null),
    'me.json': { data: { me: { id: '8800001', username: 'compte.test' } } },
    'non-connecte.json': {
      data: { me: null },
      errors: [{ message: 'Not authenticated', extensions: { code: 'UNAUTHENTICATED' } }],
    },
  }
}

export function writeSyncFixtures(root = ROOT): string[] {
  const out = join(root, 'tests/fixtures/sync')
  const written: string[] = []
  const put = (dir: string, files: Record<string, unknown>) => {
    mkdirSync(join(out, dir), { recursive: true })
    for (const [name, data] of Object.entries(files)) {
      const p = join(out, dir, name)
      writeFileSync(p, typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`)
      written.push(p)
    }
  }
  put('x', xFixtures())
  put('x/bundle', xBundleFixtures())
  put('instagram', igFixtures())
  put('cosmos', cosmosFixtures())
  return written
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = writeSyncFixtures()
  console.log(`make-sync-fixtures : ${files.length} fichiers dans tests/fixtures/sync`)
}
