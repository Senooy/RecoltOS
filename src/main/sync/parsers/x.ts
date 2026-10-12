/**
 * X parser: GraphQL `Bookmarks` page (and `BookmarkFolderTimeline`) → `NormalizedPost[]`.
 * Pure function, never throws.
 *
 * Two accepted shapes:
 *  - legacy client (`responsive-web`): `entryId`, `sortIndex`, `content.itemContent.tweet_results`,
 *    tweet `legacy.{full_text, entities, extended_entities, created_at…}`;
 *  - x-web client (persisted Relay query `bookmarksQuery`, since autumn 2026): `entry_id`,
 *    `sort_index`, `content.__typename` + `content.content.tweet_results`, cursor `cursor_type`, tweet
 *    `details.{full_text, display_text_range, created_at_ms}`, `media_entities2`, `url_entities`,
 *    `quoted_tweet_results`, `legacy.retweeted_status_results`, `reply_to_results`. Each entry and
 *    each x-web tweet is first brought back to the legacy shape (`normalizeEntry`, `fromXWeb`).
 *
 * Choices (documented in the report):
 *  - repost of a liked post: content, key and URL of the ORIGINAL; the reposter goes in `extra.retweetedBy`;
 *  - thread: the page only contains the liked tweet, not its parent. The reply link is
 *    exposed (`extra.selfReply`, `inReplyToId`, `conversationId`) and `post_meta.thread` stays `[]`;
 *  - cursor: `null` if the page contains no tweet entry (even if there are cursors). A page
 *    made only of deleted tweets keeps its cursor (otherwise pagination would stop wrongly).
 */
import type { QuotedPost } from '../../../shared/post-meta'
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
  toPostAuthor,
  toPostMedia,
  uniqueAuthors,
  webUrl,
} from './common'
import type {
  NormalizedAuthor,
  NormalizedMedia,
  NormalizedPost,
  PageParseOptions,
  PageParseResult,
  XPostExtra,
} from './types'

const DIGITS = /^\d+$/
const SCREEN_NAME = /^[A-Za-z0-9_]{1,50}$/
/** Epoch of X snowflakes (ms). */
const TWITTER_EPOCH = 1288834974657n

// ------------------------------------------------------------------------------------ errors

/** X error codes related to authentication (token, session, CSRF). */
const AUTH_CODES = new Set([32, 89, 99, 135, 215, 220, 239, 326, 353])

function classifyErrors(errors: unknown): PageParseResult | null {
  const list = arr(errors).filter(isObj)
  if (list.length === 0) return null
  for (const e of list) {
    const code = num(e.code) ?? num(obj(e.extensions).code)
    const message = str(e.message) ?? ''
    if (code === 88 || /rate limit/i.test(message)) {
      return errorResult('x', 'rate_limited', 'rate_limit', message || 'Rate limit')
    }
    const features = /features cannot be null:\s*(.+)$/i.exec(message)
    if (code === 336 || features) {
      const missingFeatures = (features?.[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^[A-Za-z0-9_]{1,128}$/.test(s))
      return errorResult('x', 'api_changed', 'features_missing', message, { missingFeatures })
    }
    if ((code !== null && AUTH_CODES.has(code)) || /authenticat|csrf|login/i.test(message)) {
      return errorResult('x', 'auth_required', 'auth', message || 'Authentification requise')
    }
  }
  const first = list[0]!
  return errorResult('x', 'api_changed', 'graphql_error', str(first.message) ?? 'GraphQL error')
}

// ------------------------------------------------------------------------------------ timeline

function findInstructions(data: Json): unknown[] | null {
  for (const key of ['bookmark_timeline_v2', 'bookmark_collection_timeline', 'bookmark_timeline']) {
    const tl = obj(obj(data[key]).timeline)
    if (Array.isArray(tl.instructions)) return tl.instructions as unknown[]
  }
  // Possible renaming of the root: first `data.<key>.timeline.instructions` found.
  for (const v of Object.values(data)) {
    const tl = obj(obj(v).timeline)
    if (Array.isArray(tl.instructions)) return tl.instructions as unknown[]
  }
  return null
}

/**
 * x-web entry (`entry_id`, `sort_index`, `content.__typename`) → legacy shape (`entryId`,
 * `sortIndex`, `content.itemContent` / cursor `cursorType`). A legacy entry is returned as is.
 */
export function normalizeEntry(e: Json): Json {
  if (e.entry_id === undefined && e.sort_index === undefined) return e
  return {
    entryId: e.entry_id,
    sortIndex: e.sort_index,
    content: normalizeContent(obj(e.content)),
  }
}

function normalizeContent(c: Json): Json {
  const tn = str(c.__typename)
  if (tn === 'TimelineTimelineCursor' || c.cursor_type !== undefined) {
    return { __typename: 'TimelineTimelineCursor', cursorType: c.cursor_type, value: c.value }
  }
  if (Array.isArray(c.items)) {
    // x-web module: `items[].{entry_id, item.content}`.
    return {
      items: c.items.map((it) => {
        const io = obj(it)
        return {
          entryId: io.entry_id ?? io.entryId,
          item: {
            itemContent: itemContentOf(obj(obj(io.item).content ?? obj(io.item).itemContent)),
          },
        }
      }),
    }
  }
  if (isObj(c.content)) return { itemContent: itemContentOf(c.content) }
  return c
}

/** x-web item content (`TimelineTweet`) → legacy `itemContent`. */
function itemContentOf(ic: Json): Json {
  if (ic.itemType !== undefined || ic.tweetResult !== undefined) return ic
  return {
    ...ic,
    itemType: ic.__typename,
    ...(isObj(ic.promoted_metadata) ? { promotedMetadata: ic.promoted_metadata } : {}),
  }
}

/** Flattened entries: `TimelineAddEntries`, `TimelineReplaceEntry`, modules and `AddToModule`. */
function flattenEntries(instructions: unknown[]): Json[] {
  const out: Json[] = []
  const push = (raw: unknown) => {
    if (!isObj(raw) || out.length >= MAX_ENTRIES) return
    const e = normalizeEntry(raw)
    const content = obj(e.content)
    const items = content.items
    if (Array.isArray(items)) {
      // Module (conversation): each item becomes an entry.
      for (const it of items) {
        const io = obj(it)
        push({
          entryId: io.entryId,
          sortIndex: e.sortIndex,
          content: { itemContent: obj(io.item).itemContent },
        })
      }
      return
    }
    out.push(e)
  }
  for (const ins of instructions) {
    const i = obj(ins)
    if (Array.isArray(i.entries)) for (const e of i.entries) push(e)
    if (isObj(i.entry)) push(i.entry)
    const moduleItems = Array.isArray(i.moduleItems)
      ? i.moduleItems
      : Array.isArray(i.module_items)
        ? i.module_items
        : []
    for (const mi of moduleItems) {
      const m = obj(mi)
      const item = obj(m.item)
      push({
        entryId: m.entryId ?? m.entry_id,
        content: {
          itemContent: isObj(item.itemContent)
            ? item.itemContent
            : itemContentOf(obj(item.content)),
        },
      })
    }
  }
  return out
}

function bottomCursor(entryId: string | null, content: Json): string | null | undefined {
  const ic = obj(content.itemContent)
  const type = str(content.cursorType) ?? str(ic.cursorType)
  const isCursor =
    (entryId !== null && entryId.startsWith('cursor-')) ||
    content.entryType === 'TimelineTimelineCursor' ||
    content.__typename === 'TimelineTimelineCursor' ||
    type !== null
  if (!isCursor) return undefined
  const bottom = type === 'Bottom' || (entryId !== null && entryId.startsWith('cursor-bottom'))
  return bottom ? cursorStr(content.value ?? ic.value) : null
}

// ------------------------------------------------------------------------------------ tweets

type Unwrapped = { tweet: Json } | { unavailable: string } | null

/** `TweetWithVisibilityResults` → tweet; tombstone / unavailable → reason; otherwise tweet. */
function unwrap(r: unknown, depth = 0): Unwrapped {
  if (!isObj(r) || depth > 3) return null
  const tn = str(r.__typename)
  if (
    tn === 'TweetWithVisibilityResults' ||
    tn === 'TweetPreviewDisplay' ||
    (tn === null && isObj(r.tweet) && !isObj(r.legacy) && !isObj(r.details))
  ) {
    return unwrap(r.tweet, depth + 1)
  }
  if (tn === 'TweetTombstone' || tn === 'TweetUnavailable' || isObj(r.tombstone)) {
    return { unavailable: tn ?? 'TweetTombstone' }
  }
  if (tn !== null && tn !== 'Tweet') return { unavailable: tn }
  return { tweet: fromXWeb(r) }
}

/** x-web client tweet? (`details`, `media_entities2` or `url_entities`, without `legacy.full_text`). */
function isXWebTweet(t: Json): boolean {
  const legacy = obj(t.legacy)
  return (
    (isObj(t.details) || Array.isArray(t.media_entities2) || Array.isArray(t.url_entities)) &&
    legacy.full_text === undefined &&
    legacy.text === undefined
  )
}

/**
 * x-web tweet → legacy shape (`legacy.full_text`, `entities.urls`, `extended_entities.media`,
 * `created_at_ms`, reply, repost, quote). The `t.co` link of a media (missing from
 * `media_entities2`) is read back from the text via its `indices` (code points) so it is removed
 * as before.
 */
export function fromXWeb(t: Json): Json {
  if (!isXWebTweet(t)) return t
  const details = obj(t.details)
  const legacy = obj(t.legacy)
  const full = str(details.full_text)
  const cps = full !== null ? Array.from(full) : []
  const media = arr(t.media_entities2).map((m) => {
    const o = obj(m)
    if (str(o.url) !== null) return o
    const [a, b] = arr(o.indices).map(num)
    const slice =
      a !== null && a !== undefined && b !== null && b !== undefined && b > a && b <= cps.length
        ? cps.slice(a, b).join('')
        : null
    return slice !== null && /^https?:\/\/t\.co\/\w+$/.test(slice) ? { ...o, url: slice } : o
  })
  const replyUser = obj(obj(t.reply_to_user_results).result)
  const quoted = obj(t.quoted_tweet_results)
  const rt = obj(legacy.retweeted_status_results)
  return {
    ...t,
    legacy: {
      ...legacy,
      ...(full !== null ? { full_text: full } : {}),
      ...(Array.isArray(details.display_text_range)
        ? { display_text_range: details.display_text_range }
        : {}),
      created_at_ms: details.created_at_ms,
      entities: { urls: arr(t.url_entities), media },
      extended_entities: { media },
      in_reply_to_status_id_str: obj(t.reply_to_results).rest_id ?? null,
      in_reply_to_user_id_str: obj(t.reply_to_user_results).rest_id ?? replyUser.rest_id ?? null,
      in_reply_to_screen_name: obj(replyUser.core).screen_name ?? null,
      ...(rt.result !== undefined ? { retweeted_status_result: { result: rt.result } } : {}),
      ...(quoted.rest_id !== undefined ? { quoted_status_id_str: quoted.rest_id } : {}),
    },
    ...(quoted.result !== undefined ? { quoted_status_result: { result: quoted.result } } : {}),
  }
}

function tweetId(t: Json): string | null {
  return idStr(t.rest_id, DIGITS) ?? idStr(obj(t.legacy).id_str, DIGITS)
}

/** Enlarged X avatar: `_normal` / `_bigger` / `_mini` / `_200x200` → `_400x400`. */
export function xAvatar400(url: string | null): string | null {
  if (url === null) return null
  const u = new URL(url)
  u.pathname = u.pathname.replace(
    /_(normal|bigger|mini|reasonably_small|200x200|x96)(\.[A-Za-z0-9]+)?$/,
    '_400x400$2',
  )
  return u.href
}

function xAuthor(t: Json): NormalizedAuthor | null {
  let u = obj(obj(obj(t.core).user_results).result)
  if (u.__typename === 'UserWithVisibilityResults') u = obj(u.user)
  if (u.__typename === 'UserUnavailable') return null
  const core = obj(u.core)
  const leg = obj(u.legacy)
  const name = cleanText(nonEmpty(core.name) ?? leg.name)
  const handle = cleanHandle(core.screen_name ?? leg.screen_name)
  const avatar = webUrl(obj(u.avatar).image_url) ?? webUrl(leg.profile_image_url_https)
  if (name === null && handle === null) return null
  return { id: idStr(u.rest_id, DIGITS), name, handle, avatarUrl: xAvatar400(avatar) }
}

/** `Wed Oct 08 12:00:00 +0000 2026` → ms. */
export function parseXDate(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = /^\w{3} (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/.exec(v)
  if (!m) {
    const t = v.length <= 100 ? Date.parse(v) : NaN
    return Number.isFinite(t) ? t : null
  }
  const month = 'JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(m[1]!) / 3
  if (!Number.isInteger(month) || month < 0) return null
  const offset = (m[6] === '-' ? -1 : 1) * (Number(m[7]) * 60 + Number(m[8])) * 60_000
  const t = Date.UTC(Number(m[9]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]))
  return Number.isFinite(t) ? t - offset : null
}

/** `created_at_ms` from the x-web client (number, or digit string). */
function msOf(v: unknown): number | null {
  if (typeof v === 'string' && /^\d{10,16}$/.test(v)) return Number(v)
  return posInt(v)
}

/** Date of a snowflake ID (fallback if `created_at` is missing). */
export function snowflakeMs(id: string): number | null {
  if (!DIGITS.test(id) || id.length < 15 || id.length > 20) return null
  const ms = Number((BigInt(id) >> 22n) + TWITTER_EPOCH)
  return Number.isSafeInteger(ms) ? ms : null
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/**
 * Cleaned text: `note_tweet` takes priority, `t.co` replaced by their original URL, `t.co` of
 * media removed, leading reply mentions removed, permalink of the quoted tweet removed at the end.
 */
function xText(t: Json, quotedId: string | null): { text: string | null; note: boolean } {
  const legacy = obj(t.legacy)
  const entities = obj(legacy.entities)
  const note = obj(obj(obj(t.note_tweet).note_tweet_results).result)
  const noteText = nonEmpty(note.text) !== null ? str(note.text) : null
  let text: string
  let urls = arr(entities.urls)
  if (noteText !== null) {
    text = noteText
    urls = [...arr(obj(note.entity_set).urls), ...urls]
  } else {
    const full = str(legacy.full_text) ?? str(legacy.text)
    if (full === null) return { text: null, note: false }
    text = full
    // Leading reply mentions (`display_text_range[0]`, in code points).
    const start = num(arr(legacy.display_text_range)[0])
    if (start !== null && start > 0) {
      const cps = Array.from(text)
      const prefix = cps.slice(0, start).join('')
      if (/^(\s*@\w+)+\s*$/.test(prefix)) text = cps.slice(start).join('')
    }
    text = decodeEntities(text)
  }
  for (const u of urls) {
    const o = obj(u)
    const short = str(o.url)
    const expanded = webUrl(o.expanded_url, true)
    if (short && expanded && short.length < 100) text = text.split(short).join(expanded)
  }
  const mediaList = [...arr(obj(legacy.extended_entities).media), ...arr(entities.media)]
  for (const m of mediaList) {
    const short = str(obj(m).url)
    if (short && short.length < 100) text = text.split(short).join('')
  }
  if (quotedId !== null) {
    const re = new RegExp(
      `\\s*https?://(?:www\\.|mobile\\.)?(?:x|twitter)\\.com/[^/\\s]+/status/${quotedId}\\S*\\s*$`,
    )
    text = text.replace(re, '')
  }
  return { text: cleanText(text.replace(/[ \t]+$/gm, '')), note: noteText !== null }
}

/** `name=orig` URL of a photo `pbs.twimg.com/media/<key>.<ext>`. */
export function xPhotoOrig(url: string): string {
  const u = new URL(url)
  if (u.hostname !== 'pbs.twimg.com') return u.href
  const m = /\.(jpe?g|png|webp|gif)$/i.exec(u.pathname)
  let format = (u.searchParams.get('format') ?? 'jpg').toLowerCase()
  if (m) {
    format = m[1]!.toLowerCase()
    u.pathname = u.pathname.slice(0, -m[0].length)
  }
  if (format === 'jpeg') format = 'jpg'
  u.search = ''
  u.searchParams.set('format', format)
  u.searchParams.set('name', 'orig')
  return u.href
}

function resolutionOf(url: string): number {
  const m = /\/(\d{2,5})x(\d{2,5})\//.exec(url)
  return m ? Number(m[1]) * Number(m[2]) : 0
}

/** Best mp4 variant (bitrate, then resolution read from the path). */
export function bestMp4(variants: unknown): string | null {
  let best: { url: string; bitrate: number; res: number } | null = null
  for (const v of arr(variants)) {
    const o = obj(v)
    const url = webUrl(o.url)
    if (url === null) continue
    const ct = (str(o.content_type) ?? '').toLowerCase()
    const isMp4 = ct === 'video/mp4' || (ct === '' && /\.mp4$/i.test(new URL(url).pathname))
    if (!isMp4) continue
    const cand = { url, bitrate: num(o.bitrate) ?? 0, res: resolutionOf(url) }
    if (
      best === null ||
      cand.bitrate > best.bitrate ||
      (cand.bitrate === best.bitrate && cand.res > best.res)
    ) {
      best = cand
    }
  }
  return best?.url ?? null
}

function hlsOf(variants: unknown): string | null {
  for (const v of arr(variants)) {
    const o = obj(v)
    const url = webUrl(o.url)
    if (url === null) continue
    const ct = (str(o.content_type) ?? '').toLowerCase()
    if (ct === 'application/x-mpegurl' || /\.m3u8$/i.test(new URL(url).pathname)) return url
  }
  return null
}

function xMediaList(t: Json, onDrop: (reason: string) => void): NormalizedMedia[] {
  const legacy = obj(t.legacy)
  let list = arr(obj(legacy.extended_entities).media)
  if (list.length === 0) list = arr(obj(legacy.entities).media)
  const out: NormalizedMedia[] = []
  for (const raw of list.slice(0, MAX_MEDIA_PER_POST)) {
    const m = obj(raw)
    const type = str(m.type)
    const base = webUrl(m.media_url_https)
    const info = obj(m.original_info)
    const width = posInt(info.width)
    const height = posInt(info.height)
    if (type === 'photo') {
      if (base === null) {
        onDrop('photo without media_url_https')
        continue
      }
      out.push({ ...emptyMedia('image'), url: xPhotoOrig(base), width, height })
    } else if (type === 'video' || type === 'animated_gif') {
      const vi = obj(m.video_info)
      const mp4 = bestMp4(vi.variants)
      const hls = hlsOf(vi.variants)
      if (mp4 === null && hls === null) {
        onDrop('video without a usable variant')
        continue
      }
      out.push({
        ...emptyMedia('video'),
        url: mp4,
        hlsUrl: hls,
        hlsOnly: mp4 === null,
        posterUrl: base,
        width,
        height,
        durationMs: posInt(vi.duration_millis),
        gif: type === 'animated_gif',
      })
    } else {
      onDrop(`unknown media type (${type ?? '?'})`)
    }
  }
  return out
}

function canonicalUrl(handle: string | null, id: string): string {
  const who = handle !== null && SCREEN_NAME.test(handle) ? handle : 'i'
  return `https://x.com/${who}/status/${id}`
}

function quotedOf(t: Json): {
  quoted: QuotedPost | null
  author: NormalizedAuthor | null
  id: string | null
  unavailable: boolean
} {
  const raw = obj(t.quoted_status_result).result
  if (raw === undefined) return { quoted: null, author: null, id: null, unavailable: false }
  const u = unwrap(raw)
  const legacyQid = idStr(obj(t.legacy).quoted_status_id_str, DIGITS)
  if (u === null || 'unavailable' in u) {
    return { quoted: null, author: null, id: legacyQid, unavailable: true }
  }
  const q = u.tweet
  const id = tweetId(q)
  const author = xAuthor(q)
  const media = xMediaList(q, () => {})
  const { text } = xText(q, null)
  return {
    quoted: {
      author: toPostAuthor(author),
      text,
      url: id !== null ? canonicalUrl(author?.handle ?? null, id) : null,
      media: media.map(toPostMedia),
    },
    author,
    id: id ?? legacyQid,
    unavailable: false,
  }
}

function toPost(
  entryTweet: Json,
  sortIndex: string | null,
  position: number,
  onDrop: (reason: string) => void,
): NormalizedPost {
  if (tweetId(entryTweet) === null) fail('rest_id missing')
  let t = entryTweet
  let retweetedBy: NormalizedAuthor | null = null
  let retweetId: string | null = null
  const rt = obj(obj(entryTweet.legacy).retweeted_status_result).result
  if (rt !== undefined) {
    const u = unwrap(rt)
    if (u !== null && 'tweet' in u && tweetId(u.tweet) !== null) {
      retweetedBy = xAuthor(entryTweet)
      retweetId = tweetId(entryTweet)
      t = u.tweet
    }
  }
  const id = tweetId(t)
  if (id === null) fail('rest_id missing')
  if (!isObj(t.legacy)) fail('legacy missing')
  const legacy = t.legacy
  const author = xAuthor(t)
  const q = quotedOf(t)
  const { text, note } = xText(t, q.id)
  const media = xMediaList(t, onDrop)
  const sourceUrl = canonicalUrl(author?.handle ?? null, id)
  const postedAt = parseXDate(legacy.created_at) ?? msOf(legacy.created_at_ms) ?? snowflakeMs(id)
  const inReplyToHandle = cleanHandle(legacy.in_reply_to_screen_name)
  const inReplyToId = idStr(legacy.in_reply_to_status_id_str, DIGITS)
  const authorUserId = author?.id ?? null
  const selfReply =
    inReplyToId !== null &&
    ((inReplyToHandle !== null &&
      author?.handle != null &&
      inReplyToHandle.toLowerCase() === author.handle.toLowerCase()) ||
      (authorUserId !== null && idStr(legacy.in_reply_to_user_id_str, DIGITS) === authorUserId))
  const extra: XPostExtra = {
    platform: 'x',
    sortIndex,
    conversationId: idStr(legacy.conversation_id_str, DIGITS),
    inReplyToId,
    inReplyToHandle,
    selfReply,
    retweetedBy,
    retweetId,
    quotedUnavailable: q.unavailable,
    noteTweet: note,
  }
  return {
    platform: 'x',
    externalId: id,
    sourceKey: `x:${id}`,
    sourceUrl,
    kind: media[0]?.type ?? 'tweet',
    position,
    remoteSort: sortIndex,
    postedAt,
    createdAt: null,
    author,
    authors: uniqueAuthors([author, q.author, retweetedBy]),
    text,
    media,
    postMeta: buildPostMeta({
      platform: 'x',
      author,
      text,
      url: sourceUrl,
      postedAt,
      media,
      quoted: q.quoted,
    }),
    extra,
  }
}

function tweetResultOf(content: Json): unknown {
  const ic = obj(content.itemContent)
  return (
    obj(ic.tweet_results).result ?? obj(ic.tweetResult).result ?? obj(content.tweetResult).result
  )
}

// ------------------------------------------------------------------------------------ page

function parsePage(json: unknown, opts: PageParseOptions): PageParseResult {
  if (!isObj(json)) return errorResult('x', 'api_changed', 'unknown_shape', 'Unreadable X response')
  const instructions = findInstructions(obj(json.data))
  if (instructions === null) {
    return (
      classifyErrors(json.errors) ??
      errorResult('x', 'api_changed', 'unknown_shape', 'X response without a bookmarks timeline')
    )
  }
  const log = new PageLog()
  const posts: NormalizedPost[] = []
  const seen = new Set<string>()
  let nextCursor: string | null = null
  let sawTweet = false
  flattenEntries(instructions).forEach((e, index) => {
    const entryId = str(e.entryId)
    const content = obj(e.content)
    const cursor = bottomCursor(entryId, content)
    if (cursor !== undefined) {
      if (cursor !== null) nextCursor = cursor
      return
    }
    log.stats.entries += 1
    const ic = obj(content.itemContent)
    const result = tweetResultOf(content)
    const looksTweet =
      result !== undefined ||
      (entryId !== null && entryId.startsWith('tweet-')) ||
      ic.itemType === 'TimelineTweet'
    if (!looksTweet) {
      log.note('ignored', index, entryId, 'non-tweet entry')
      return
    }
    sawTweet = true
    if (isObj(ic.promotedMetadata)) {
      log.note('ignored', index, entryId, 'sponsored content')
      return
    }
    const u = unwrap(result)
    if (u === null) {
      log.note('malformed', index, entryId, 'tweet_results missing or unreadable')
      return
    }
    if ('unavailable' in u) {
      log.note('unavailable', index, entryId, u.unavailable)
      return
    }
    try {
      const post = toPost(u.tweet, str(e.sortIndex), posts.length, (reason) =>
        log.note('media_dropped', index, entryId, reason),
      )
      if (seen.has(post.sourceKey)) {
        log.note('ignored', index, entryId, 'duplicate on the page')
        return
      }
      seen.add(post.sourceKey)
      posts.push(post)
      log.stats.parsed += 1
    } catch (err) {
      // Any error in an entry isolates it (unexpected shape); the page continues.
      log.note(
        'malformed',
        index,
        entryId,
        err instanceof EntryError ? err.message : errMessage(err),
      )
    }
  })
  return {
    ok: true,
    platform: 'x',
    posts,
    nextCursor: sawTweet ? finalCursor(nextCursor, opts.requestCursor) : null,
    stats: log.stats,
    issues: log.issues,
  }
}

/**
 * `Bookmarks` page → normalized posts + cursor. Accepts the JSON object or its string.
 * Never throws: an unknown shape yields `{ ok: false, error }`.
 */
export function parseXBookmarksPage(json: unknown, opts: PageParseOptions = {}): PageParseResult {
  try {
    return parsePage(coerceJson(json), opts)
  } catch (err) {
    return errorResult('x', 'api_changed', 'exception', errMessage(err))
  }
}
