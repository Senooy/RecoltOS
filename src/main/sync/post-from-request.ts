/**
 * Publication à enregistrer depuis l'extension (`save.create {kind:'post'}`, SYNC §2.4) : donnée brute
 * en cache (`tweet_results.result` X, `media` Instagram, élément Cosmos) passée aux parseurs de WP-55
 * dans une page synthétique ; sinon repli DOM (`partial`) : texte, auteur, images.
 */
import type { SaveRequest } from '../../shared/bridge/save'
import { PostMetaSchema } from '../../shared/post-meta'
import { parseSyncPage, SOURCE_KEY_PREFIX, type NormalizedPost } from './parsers'

function wrap(platform: 'x' | 'instagram' | 'cosmos', raw: unknown, id: string): unknown {
  if (platform === 'x') {
    return {
      data: {
        bookmark_timeline_v2: {
          timeline: {
            instructions: [
              {
                type: 'TimelineAddEntries',
                entries: [
                  {
                    entryId: `tweet-${id}`,
                    sortIndex: '0',
                    content: {
                      entryType: 'TimelineTimelineItem',
                      itemContent: { itemType: 'TimelineTweet', tweet_results: { result: raw } },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    }
  }
  if (platform === 'instagram')
    return { items: [{ media: raw }], more_available: false, status: 'ok' }
  return { data: { allElementsV2: { items: [raw], meta: { nextPageCursor: null } } } }
}

const httpsOnly = (urls: unknown): string[] =>
  Array.isArray(urls)
    ? urls.filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 20)
    : []

export function postFromRequest(req: SaveRequest): NormalizedPost | null {
  const p = req.post
  if (!p) return null
  if (p.raw !== undefined && p.raw !== null) {
    const r = parseSyncPage(p.platform, wrap(p.platform, p.raw, p.externalId))
    if (r.ok) {
      const hit = r.posts.find((x) => x.externalId === p.externalId) ?? r.posts[0]
      if (hit) return hit
    }
  }
  // Repli DOM : publication partielle (le backfill la complètera s'il la revoit).
  const dom = (p.dom ?? {}) as {
    text?: unknown
    authorName?: unknown
    authorHandle?: unknown
    imageUrls?: unknown
  }
  const images = httpsOnly(dom.imageUrls)
  const handle =
    typeof dom.authorHandle === 'string' ? dom.authorHandle.replace(/^@/, '').slice(0, 100) : null
  const name = typeof dom.authorName === 'string' ? dom.authorName.slice(0, 200) : null
  const text = typeof dom.text === 'string' ? dom.text.slice(0, 30_000) : null
  const author = handle || name ? { id: null, name, handle, avatarUrl: null } : null
  const sourceUrl = req.pageUrl
  const postMeta = PostMetaSchema.parse({
    v: 1,
    platform: p.platform,
    author: author ? { name, handle, avatarUrl: null } : null,
    text,
    url: sourceUrl,
    postedAt: null,
    media: images.map((u) => ({ type: 'image', remoteUrl: u, posterUrl: null, mediaUuid: null })),
    quoted: null,
    thread: [],
  })
  return {
    platform: p.platform,
    externalId: p.externalId,
    sourceKey: `${SOURCE_KEY_PREFIX[p.platform]}:${p.externalId}`,
    sourceUrl,
    kind: images.length ? 'image' : 'tweet',
    position: 0,
    remoteSort: null,
    postedAt: null,
    createdAt: null,
    author,
    authors: author ? [author] : [],
    text,
    media: images.map((u) => ({
      type: 'image' as const,
      url: u,
      fallbackUrl: null,
      hlsUrl: null,
      hlsOnly: false,
      posterUrl: null,
      width: null,
      height: null,
      durationMs: null,
      gif: false,
    })),
    postMeta,
    extra:
      p.platform === 'x'
        ? {
            platform: 'x',
            sortIndex: null,
            conversationId: null,
            inReplyToId: null,
            inReplyToHandle: null,
            selfReply: false,
            retweetedBy: null,
            retweetId: null,
            quotedUnavailable: false,
            noteTweet: false,
          }
        : p.platform === 'instagram'
          ? {
              platform: 'instagram',
              pk: null,
              igCollections: [],
              productType: null,
              mediaType: images.length > 1 ? 8 : 1,
              expiresAt: null,
            }
          : {
              platform: 'cosmos',
              savedAt: null,
              linkUrl: null,
              websiteTitle: null,
              generatedCaption: null,
              ownerId: null,
            },
  }
}
