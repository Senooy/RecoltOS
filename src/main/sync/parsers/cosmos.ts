/**
 * Cosmos parser: GraphQL response `GetAllElements` (`allElementsV2`) → normalized posts.
 * Pure function, never throws.
 *
 *  - image: `media.url` / `multipleMedia[]` on `cdn.cosmos.so`, WITHOUT `?format=webp` (original);
 *    fallback `?format=jpeg` in `fallbackUrl`;
 *  - video: `mux.downloadableUrl ?? mux.mp4Url ?? video.url`, poster `video.thumbnailUrl`;
 *  - website: `kind = 'url'`, `extra.linkUrl = source.url`, the tile thumbnail as media;
 *  - text tile: ignored in V1 and counted (`stats.ignored`).
 *
 * Two accepted shapes: the old one (`video` / `mux` at the element level,
 * `source.author` string) and the one from the schema observed on 2026-10-12 (extension request): media
 * typed (`__typename` `StaticImage` / `AnimatedImage` / `Video`) with `Video.mux.mp4Url`,
 * `Video.thumbnail.url`, `AnimatedImage.video.{url, thumbnailUrl}`; `source.author` object
 * (`fullName`, `username`); typed tile (`TextElementTile` → text).
 */
import {
  arr,
  buildPostMeta,
  cleanText,
  coerceJson,
  cursorStr,
  dateMs,
  EntryError,
  emptyMedia,
  errMessage,
  errorResult,
  fail,
  finalCursor,
  idStr,
  isObj,
  type Json,
  MAX_ENTRIES,
  MAX_MEDIA_PER_POST,
  nonEmpty,
  obj,
  PageLog,
  posInt,
  str,
  webUrl,
  withoutParam,
  withParam,
} from './common'
import type {
  CosmosPostExtra,
  NormalizedAuthor,
  NormalizedMedia,
  NormalizedPost,
  PageParseOptions,
  PageParseResult,
} from './types'

function isCosmosCdn(url: string): boolean {
  const host = new URL(url).hostname
  return host === 'cosmos.so' || host.endsWith('.cosmos.so')
}

/** Cosmos original: `format` parameter removed (only on the Cosmos CDN). */
export function cosmosOriginal(url: string | null): string | null {
  if (url === null) return null
  return isCosmosCdn(url) ? withoutParam(url, 'format') : url
}

function cosmosImage(raw: unknown): NormalizedMedia | null {
  const o = obj(raw)
  const src = webUrl(o.url)
  if (src === null) return null
  const url = cosmosOriginal(src)!
  return {
    ...emptyMedia('image'),
    url,
    fallbackUrl: isCosmosCdn(url) ? withParam(url, 'format', 'jpeg') : null,
    width: posInt(o.width),
    height: posInt(o.height),
  }
}

function classifyErrors(errors: unknown): PageParseResult | null {
  const list = arr(errors).filter(isObj)
  if (list.length === 0) return null
  for (const e of list) {
    const code = str(obj(e.extensions).code) ?? ''
    const message = str(e.message) ?? ''
    if (
      /UNAUTHENTICATED|AUTHENTICATION|FORBIDDEN/i.test(code) ||
      /not authenticated|unauthori[sz]ed|jwt/i.test(message)
    ) {
      return errorResult('cosmos', 'auth_required', 'unauthenticated', message || code)
    }
    if (/RATE.?LIMIT|TOO_MANY/i.test(code) || /rate.?limit|too many requests/i.test(message)) {
      return errorResult('cosmos', 'rate_limited', 'rate_limit', message || code)
    }
  }
  return errorResult(
    'cosmos',
    'api_changed',
    'graphql_error',
    str(list[0]!.message) ?? 'Erreur GraphQL',
  )
}

/** `data.allElementsV2`, otherwise the first `data.<key>` that has `items[]` (renaming). */
function findConnection(data: Json): Json | null {
  if (isObj(data.allElementsV2) && Array.isArray(data.allElementsV2.items))
    return data.allElementsV2
  for (const v of Object.values(data)) if (isObj(v) && Array.isArray(v.items)) return v
  return null
}

function cosmosPost(
  el: Json,
  position: number,
  onDrop: (reason: string) => void,
): NormalizedPost | 'text' {
  const id = idStr(el.id)
  if (id === null) fail('id absent')
  const images: NormalizedMedia[] = []
  const seenUrls = new Set<string>()
  const addImage = (raw: unknown, label: string) => {
    if (raw === null || raw === undefined || images.length >= MAX_MEDIA_PER_POST) return
    const img = cosmosImage(raw)
    if (img === null) {
      onDrop(`${label} sans URL exploitable`)
      return
    }
    if (seenUrls.has(img.url!)) return
    seenUrls.add(img.url!)
    images.push(img)
  }
  const typed = [el.media, ...arr(el.multipleMedia)].filter(isObj)
  const isVideoMedia = (m: Json) => m.__typename === 'Video' || m.__typename === 'AnimatedImage'
  const firstVideo = typed.find(isVideoMedia) ?? null
  if (!isObj(el.media) || !isVideoMedia(el.media)) addImage(el.media, 'media')
  arr(el.multipleMedia).forEach((m, i) => {
    if (!isObj(m) || !isVideoMedia(m)) addImage(m, `multipleMedia[${i}]`)
  })

  const mux = obj(el.mux)
  const video = obj(el.video)
  // Typed video media (current schema): Mux mp4, otherwise the media URL; animated GIF: its video.
  const typedVideoUrl =
    firstVideo === null
      ? null
      : firstVideo.__typename === 'Video'
        ? (webUrl(obj(firstVideo.mux).mp4Url) ?? webUrl(firstVideo.url))
        : webUrl(obj(firstVideo.video).url)
  const typedPoster =
    firstVideo === null
      ? null
      : firstVideo.__typename === 'Video'
        ? webUrl(obj(firstVideo.thumbnail).url)
        : (webUrl(obj(firstVideo.video).thumbnailUrl) ?? webUrl(firstVideo.url))
  const videoUrl =
    webUrl(mux.downloadableUrl) ?? webUrl(mux.mp4Url) ?? webUrl(video.url) ?? typedVideoUrl
  const websiteTitle = cleanText(el.websiteTitle)
  const source = obj(el.source)
  const linkUrl = webUrl(source.url, true)

  let kind: NormalizedPost['kind']
  let media: NormalizedMedia[]
  if (videoUrl !== null) {
    kind = 'video'
    media = [
      {
        ...emptyMedia('video'),
        url: videoUrl,
        posterUrl:
          cosmosOriginal(webUrl(video.thumbnailUrl) ?? typedPoster) ?? images[0]?.url ?? null,
        width: posInt(firstVideo?.width) ?? images[0]?.width ?? null,
        height: posInt(firstVideo?.height) ?? images[0]?.height ?? null,
        gif: firstVideo?.__typename === 'AnimatedImage',
      },
    ]
  } else if (websiteTitle !== null && linkUrl !== null) {
    kind = 'url'
    media = images
  } else if (images.length > 0) {
    kind = 'image'
    media = images
  } else if (nonEmpty(el.text) !== null || el.__typename === 'TextElementTile') {
    return 'text'
  } else {
    fail('élément sans média ni lien')
  }

  // `source.author`: string (old shape) or object `{ fullName, username }`.
  const authorObj = obj(source.author)
  const name = isObj(source.author)
    ? cleanText(nonEmpty(authorObj.fullName) ?? authorObj.username)
    : cleanText(source.author)
  const handle = isObj(source.author) ? cleanText(authorObj.username) : null
  const author: NormalizedAuthor | null =
    name !== null ? { id: null, name, handle, avatarUrl: null } : null
  const sourceUrl = `https://www.cosmos.so/e/${encodeURIComponent(id)}`
  const text = kind === 'url' ? websiteTitle : null
  const extra: CosmosPostExtra = {
    platform: 'cosmos',
    savedAt: dateMs(el.createdAt),
    linkUrl: kind === 'url' ? linkUrl : null,
    websiteTitle,
    generatedCaption: cleanText(obj(el.generatedCaption).text),
    ownerId: idStr(el.ownerId),
  }
  return {
    platform: 'cosmos',
    externalId: id,
    sourceKey: `cosmos:${id}`,
    sourceUrl,
    kind,
    position,
    remoteSort: null,
    postedAt: null,
    createdAt: null,
    author,
    authors: [],
    text,
    media,
    postMeta: buildPostMeta({
      platform: 'cosmos',
      author,
      text,
      url: sourceUrl,
      postedAt: null,
      media,
    }),
    extra,
  }
}

function parsePage(json: unknown, opts: PageParseOptions): PageParseResult {
  if (!isObj(json)) {
    return errorResult('cosmos', 'api_changed', 'unknown_shape', 'Réponse Cosmos illisible')
  }
  const conn = findConnection(obj(json.data))
  if (conn === null) {
    return (
      classifyErrors(json.errors) ??
      errorResult('cosmos', 'api_changed', 'unknown_shape', 'Réponse Cosmos sans allElementsV2')
    )
  }
  const log = new PageLog()
  const posts: NormalizedPost[] = []
  const seen = new Set<string>()
  const items = arr(conn.items).slice(0, MAX_ENTRIES)
  items.forEach((raw, index) => {
    log.stats.entries += 1
    if (!isObj(raw)) {
      log.note('malformed', index, null, 'élément illisible')
      return
    }
    const id = str(raw.id)
    try {
      const post = cosmosPost(raw, posts.length, (reason) =>
        log.note('media_dropped', index, id, reason),
      )
      if (post === 'text') {
        log.note('ignored', index, id, 'tuile texte (V1)')
        return
      }
      if (seen.has(post.sourceKey)) {
        log.note('ignored', index, id, 'doublon dans la page')
        return
      }
      seen.add(post.sourceKey)
      posts.push(post)
      log.stats.parsed += 1
    } catch (err) {
      log.note('malformed', index, id, err instanceof EntryError ? err.message : errMessage(err))
    }
  })
  const next = cursorStr(obj(conn.meta).nextPageCursor)
  return {
    ok: true,
    platform: 'cosmos',
    posts,
    nextCursor: items.length > 0 ? finalCursor(next, opts.requestCursor) : null,
    stats: log.stats,
    issues: log.issues,
  }
}

/**
 * `GetAllElements` page → normalized posts + cursor (`meta.nextPageCursor`). Accepts
 * the JSON object or its string. Never throws.
 */
export function parseCosmosSavesPage(json: unknown, opts: PageParseOptions = {}): PageParseResult {
  try {
    return parsePage(coerceJson(json), opts)
  } catch (err) {
    return errorResult('cosmos', 'api_changed', 'exception', errMessage(err))
  }
}
