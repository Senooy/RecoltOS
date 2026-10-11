/**
 * `items.post_meta` = `PostMetaSchema` v1 (ARCHI §4.4, PLAN §1.2).
 * Forme stockée en base. Le renderer ne la voit jamais : il reçoit `PostView` (dto/items.ts).
 */
import { z } from 'zod'
import { WebUrl } from './enums'

export const PostPlatform = z.enum(['x', 'instagram', 'cosmos', 'web'])
export type PostPlatform = z.output<typeof PostPlatform>

export const PostAuthor = z.object({
  name: z.string().nullable(),
  /** Handle SANS '@'. */
  handle: z.string().nullable(),
  /** Provenance seulement ; l'affichage passe par `authors` (cache local). */
  avatarUrl: WebUrl.nullable(),
})
export type PostAuthor = z.output<typeof PostAuthor>

export const PostMedia = z.object({
  type: z.enum(['image', 'video']),
  remoteUrl: WebUrl.nullable(),
  posterUrl: WebUrl.nullable(),
  /** Lien vers `item_media.uuid` si le média est local. */
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
 * Lecture tolérante d'un JSON stocké (`safeParse`). Un échec renvoie `null` : la carte
 * s'affiche alors sans les données du post (ARCHI §4.4). `onError` permet de journaliser.
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

/** Longueur maximale du texte de post envoyé dans `ItemCard.post.text` (PLAN §4.3). */
export const POST_VIEW_TEXT_MAX = 600
