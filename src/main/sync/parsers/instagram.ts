/**
 * Instagram parser: `GET /api/v1/feed/saved/posts/` (REST) and `media/<pk>/info/` → normalized
 * posts. Pure function, never throws.
 *
 * A minimal GraphQL adapter (`data.<connection>.edges[].node`, `page_info`) produces the same
 * output: shape NOT VERIFIED against a real account, kept defensive.
 */
import {
  arr,
  buildPostMeta,
  cleanHandle,
  cleanText,
  coerceJson,
  cursorStr,
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
  num,
  obj,
  PageLog,
  posInt,
  str,
  uniqueAuthors,
  webUrl,
} from './common'
import type {
  InstagramPostExtra,
  NormalizedAuthor,
  NormalizedMedia,
  NormalizedPost,
  PageParseOptions,
  PageParseResult,
} from './types'

const DIGITS = /^\d+$/
const SHORTCODE = /^[A-Za-z0-9_-]{1,64}$/

// ------------------------------------------------------------------------------------ errors

function classifyFailure(root: Json): PageParseResult {
  const message = str(root.message) ?? str(root.error_type) ?? ''
  const token = `${message} ${str(root.error_type) ?? ''}`
  if (
    /checkpoint_required|challenge_required|login_required/i.test(token) ||
    root.require_login === true ||
    root.checkpoint_url !== undefined
  ) {
    const reason = /checkpoint_required|challenge_required|login_required/i.exec(token)?.[0]
    return errorResult(
      'instagram',
      'auth_required',
      reason?.toLowerCase() ?? 'login_required',
      message || 'Connexion requise',
    )
  }
  if (/wait a few minutes|rate.?limit|feedback_required|spam/i.test(token) || root.spam === true) {
    return errorResult('instagram', 'rate_limited', 'rate_limit', message || 'Limite atteinte')
  }
  return errorResult('instagram', 'api_changed', 'fail', message || 'Failed response')
}

// ------------------------------------------------------------------------------------ media

function bestCandidate(
  candidates: unknown,
): { url: string; w: number | null; h: number | null } | null {
  let best: { url: string; w: number | null; h: number | null; area: number } | null = null
  for (const c of arr(candidates)) {
    const o = obj(c)
    const url = webUrl(o.url)
    if (url === null) continue
    const w = posInt(o.width)
    const h = posInt(o.height)
    const area = (w ?? 0) * (h ?? 0)
    // On equal area, the platform's order wins (`candidates[0]` = the largest one in practice).
    if (best === null || area > best.area) best = { url, w, h, area }
  }
  return best && { url: best.url, w: best.w, h: best.h }
}

/** A simple IG media item (type 1 or 2), or `null` if it has no usable URL. */
function igSingle(m: Json): NormalizedMedia | null {
  const image =
    bestCandidate(obj(m.image_versions2).candidates) ??
    // Web GraphQL: `display_url` / `display_resources`.
    bestCandidate(m.display_resources) ??
    (webUrl(m.display_url) ? { url: webUrl(m.display_url)!, w: null, h: null } : null)
  const videos = arr(m.video_versions)
  const isVideo =
    num(m.media_type) === 2 ||
    videos.length > 0 ||
    m.is_video === true ||
    webUrl(m.video_url) !== null
  const width = posInt(m.original_width) ?? posInt(obj(m.dimensions).width)
  const height = posInt(m.original_height) ?? posInt(obj(m.dimensions).height)
  if (isVideo) {
    const v =
      bestCandidate(videos) ??
      (webUrl(m.video_url) ? { url: webUrl(m.video_url)!, w: null, h: null } : null)
    if (v === null) return null
    const seconds = num(m.video_duration)
    return {
      ...emptyMedia('video'),
      url: v.url,
      posterUrl: image?.url ?? null,
      width: width ?? v.w,
      height: height ?? v.h,
      durationMs: seconds !== null && seconds > 0 ? Math.round(seconds * 1000) : null,
    }
  }
  if (image === null) return null
  return {
    ...emptyMedia('image'),
    url: image.url,
    width: width ?? image.w,
    height: height ?? image.h,
  }
}

/** Signed expiry `oe=<hex seconds>` → ms. */
export function igExpiry(url: string | null): number | null {
  if (url === null) return null
  const oe = new URL(url).searchParams.get('oe')
  if (oe === null || !/^[0-9a-f]{1,12}$/i.test(oe)) return null
  return parseInt(oe, 16) * 1000
}

function igAuthor(m: Json): NormalizedAuthor | null {
  const u = isObj(m.user) ? m.user : obj(m.owner)
  const name = cleanText(u.full_name)
  const handle = cleanHandle(u.username)
  if (name === null && handle === null) return null
  return {
    id: idStr(u.pk ?? u.pk_id ?? u.id, DIGITS),
    name,
    handle,
    avatarUrl: webUrl(obj(u.hd_profile_pic_url_info).url) ?? webUrl(u.profile_pic_url),
  }
}

function igCaption(m: Json): string | null {
  const c = obj(m.caption).text
  if (typeof c === 'string') return cleanText(c)
  const edge = obj(arr(obj(m.edge_media_to_caption).edges)[0])
  return cleanText(obj(edge.node).text)
}

function igPost(m: Json, position: number, onDrop: (reason: string) => void): NormalizedPost {
  const code = idStr(m.code ?? m.shortcode, SHORTCODE)
  if (code === null) fail('code missing')
  const children = Array.isArray(m.carousel_media)
    ? m.carousel_media
    : arr(obj(m.edge_sidecar_to_children).edges).map((e) => obj(e).node)
  const declared = num(m.media_type)
  const mediaType = declared ?? (children.length > 0 ? 8 : arr(m.video_versions).length > 0 ? 2 : 1)
  const media: NormalizedMedia[] = []
  if (mediaType === 8 || children.length > 0) {
    children.slice(0, MAX_MEDIA_PER_POST).forEach((child, i) => {
      const one = isObj(child) ? igSingle(child) : null
      if (one === null) onDrop(`carousel item ${i} without a usable URL`)
      else media.push(one)
    })
    if (media.length === 0) fail('carousel without usable media')
  } else {
    const one = igSingle(m)
    if (one === null) fail('media without a usable URL')
    media.push(one)
  }
  const author = igAuthor(m)
  const text = igCaption(m)
  const takenAt = num(m.taken_at) ?? num(m.taken_at_timestamp)
  const postedAt =
    takenAt === null || takenAt <= 0 ? null : Math.round(takenAt < 1e12 ? takenAt * 1000 : takenAt)
  const sourceUrl = `https://www.instagram.com/p/${code}/`
  const expiries = media
    .flatMap((x) => [x.url, x.posterUrl])
    .map(igExpiry)
    .filter((n): n is number => n !== null)
  const pk =
    idStr(m.pk, DIGITS) ?? idStr((str(m.id) ?? '').split('_')[0], DIGITS) ?? idStr(m.id, DIGITS)
  const extra: InstagramPostExtra = {
    platform: 'instagram',
    pk,
    igCollections: arr(m.saved_collection_ids)
      .map((c) => idStr(c))
      .filter((c): c is string => c !== null),
    productType: nonEmpty(m.product_type),
    mediaType,
    expiresAt: expiries.length > 0 ? Math.min(...expiries) : null,
  }
  return {
    platform: 'instagram',
    externalId: code,
    sourceKey: `ig:${code}`,
    sourceUrl,
    kind: media[0]!.type,
    position,
    remoteSort: null,
    postedAt,
    createdAt: null,
    author,
    authors: uniqueAuthors([author]),
    text,
    media,
    postMeta: buildPostMeta({
      platform: 'instagram',
      author,
      text,
      url: sourceUrl,
      postedAt,
      media,
    }),
    extra,
  }
}

// ------------------------------------------------------------------------------------ page

/** GraphQL connection `{ edges: [{ node }], page_info }` searched under `data` (2 levels). */
function findConnection(data: Json): Json | null {
  const queue: [Json, number][] = [[data, 0]]
  while (queue.length > 0) {
    const [o, depth] = queue.shift()!
    if (Array.isArray(o.edges)) return o
    if (depth >= 2) continue
    for (const v of Object.values(o)) if (isObj(v)) queue.push([v, depth + 1])
  }
  return null
}

function parseMediaList(
  list: unknown[],
  unwrapItem: (raw: unknown) => unknown,
): { posts: NormalizedPost[]; log: PageLog } {
  const log = new PageLog()
  const posts: NormalizedPost[] = []
  const seen = new Set<string>()
  list.slice(0, MAX_ENTRIES).forEach((raw, index) => {
    log.stats.entries += 1
    const m = unwrapItem(raw)
    if (!isObj(m)) {
      log.note('malformed', index, null, 'item without media')
      return
    }
    const id = str(m.code) ?? str(m.shortcode)
    try {
      const post = igPost(m, posts.length, (reason) => log.note('media_dropped', index, id, reason))
      if (seen.has(post.sourceKey)) {
        log.note('ignored', index, id, 'duplicate on the page')
        return
      }
      seen.add(post.sourceKey)
      posts.push(post)
      log.stats.parsed += 1
    } catch (err) {
      log.note('malformed', index, id, err instanceof EntryError ? err.message : errMessage(err))
    }
  })
  return { posts, log }
}

/** `items[i]` is `{ media }` (saved/posts) or directly the media (media/<pk>/info). */
function restItem(raw: unknown): unknown {
  const o = obj(raw)
  if (isObj(o.media)) return o.media
  return 'code' in o || 'media_type' in o || 'pk' in o ? o : null
}

function parsePage(json: unknown, opts: PageParseOptions, single: boolean): PageParseResult {
  if (!isObj(json)) {
    return errorResult('instagram', 'api_changed', 'unknown_shape', 'Unreadable Instagram response')
  }
  if (Array.isArray(json.items)) {
    const { posts, log } = parseMediaList(json.items, restItem)
    const more = json.more_available === true || json.more_available === 'true'
    const next = single || !more ? null : cursorStr(json.next_max_id)
    return {
      ok: true,
      platform: 'instagram',
      posts,
      nextCursor: log.stats.entries > 0 ? finalCursor(next, opts.requestCursor) : null,
      stats: log.stats,
      issues: log.issues,
    }
  }
  if (json.status === 'fail' || typeof json.message === 'string') return classifyFailure(json)
  if (isObj(json.data)) {
    const conn = findConnection(json.data)
    if (conn !== null) {
      const { posts, log } = parseMediaList(arr(conn.edges), (e) => obj(e).node)
      const info = obj(conn.page_info)
      const next = info.has_next_page === true ? cursorStr(info.end_cursor) : null
      return {
        ok: true,
        platform: 'instagram',
        posts,
        nextCursor: log.stats.entries > 0 && !single ? finalCursor(next, opts.requestCursor) : null,
        stats: log.stats,
        issues: log.issues,
      }
    }
  }
  return errorResult(
    'instagram',
    'api_changed',
    'unknown_shape',
    'Instagram response without items',
  )
}

/**
 * `feed/saved/posts` page → normalized posts + cursor (`next_max_id` if `more_available`).
 * Accepts the JSON object or its string. Never throws.
 */
export function parseInstagramSavedPage(
  json: unknown,
  opts: PageParseOptions = {},
): PageParseResult {
  try {
    return parsePage(coerceJson(json), opts, false)
  } catch (err) {
    return errorResult('instagram', 'api_changed', 'exception', errMessage(err))
  }
}

/**
 * `media/<pk>/info/` response (`item.refresh` refresh, fresh signed URLs and avatar) →
 * same output, `nextCursor` always `null`. Never throws.
 */
export function parseInstagramMediaInfo(json: unknown): PageParseResult {
  try {
    return parsePage(coerceJson(json), {}, true)
  } catch (err) {
    return errorResult('instagram', 'api_changed', 'exception', errMessage(err))
  }
}
