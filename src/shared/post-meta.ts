/**
 * `items.post_meta` = `PostMetaSchema` v1.
 * Stored form in the database. The renderer never sees it: it receives `PostView` (dto/items.ts).
 */
import { z } from 'zod'
import { WebUrl } from './enums'

export const PostPlatform = z.enum(['x', 'instagram', 'cosmos', 'web'])
export type PostPlatform = z.output<typeof PostPlatform>

export const PostAuthor = z.object({
  name: z.string().nullable(),
  /** Handle WITHOUT '@'. */
  handle: z.string().nullable(),
  /** Provenance only; display goes through `authors` (local cache). */
  avatarUrl: WebUrl.nullable(),
})
export type PostAuthor = z.output<typeof PostAuthor>

export const PostMedia = z.object({
  type: z.enum(['image', 'video']),
  remoteUrl: WebUrl.nullable(),
  posterUrl: WebUrl.nullable(),
  /** Link to `item_media.uuid` if the media is local. */
  mediaUuid: z.uuid().nullable(),
})
export type PostMedia = z.output<typeof PostMedia>

export const QuotedPost = z.object({
  author: PostAuthor.nullable(),
  text: z.string().nullable(),
  url: WebUrl.nullable(),
  media: z.array(PostMedia).default([]),
})
export type QuotedPost = z.output<typeof QuotedPost>

export const ThreadEntry = z.object({
  text: z.string(),
  media: z.array(PostMedia).default([]),
})

export const PostMetaSchema = z.object({
  v: z.literal(1),
  platform: PostPlatform,
  author: PostAuthor.nullable(),
  text: z.string().nullable(),
  url: WebUrl.nullable(),
  postedAt: z.number().int().nullable(),
  media: z.array(PostMedia).default([]),
  quoted: QuotedPost.nullable().default(null),
  thread: z.array(ThreadEntry).default([]),
})
export type PostMeta = z.output<typeof PostMetaSchema>
export type PostMetaInput = z.input<typeof PostMetaSchema>

/**
 * Tolerant reading of a stored JSON (`safeParse`). A failure returns `null`: the card is then
 * displayed without the post data. `onError` allows logging.
 */
export function parsePostMeta(
  raw: string | null | undefined,
  onError?: (err: unknown) => void,
): PostMeta | null {
  if (raw == null || raw === '') return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (err) {
    onError?.(err)
    return null
  }
  const r = PostMetaSchema.safeParse(json)
  if (!r.success) {
    onError?.(r.error)
    return null
  }
  return r.data
}

/** Maximum length of the post text sent in `ItemCard.post.text`. */
export const POST_VIEW_TEXT_MAX = 600
