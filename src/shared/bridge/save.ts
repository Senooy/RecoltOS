/**
 * `SaveRequest` (SYNC §6.2) en zod. Stub typé créé par WP-00, possédé ensuite par WP-51.
 */
import { z } from 'zod'
import { MAX_INLINE_BASE64_CHARS, MAX_UPLOAD_BYTES } from './constants'
import { Platform } from './envelope'

export const SaveKind = z.enum(['image', 'video', 'link', 'page', 'post'])

export const SaveRequest = z
  .strictObject({
    kind: SaveKind,
    pageUrl: z.url().max(8192),
    pageTitle: z.string().max(1000).optional(),
    srcUrl: z.string().max(8192).optional(),
    linkUrl: z.string().max(8192).optional(),
    inlineMedia: z
      .object({ mime: z.string(), dataBase64: z.string().max(MAX_INLINE_BASE64_CHARS) })
      .optional(),
    upload: z
      .object({ id: z.uuid(), mime: z.string(), size: z.number().int().max(MAX_UPLOAD_BYTES) })
      .optional(),
    screenshot: z
      .object({
        mime: z.enum(['image/jpeg', 'image/png']),
        dataBase64: z.string().max(MAX_INLINE_BASE64_CHARS),
        width: z.number().int(),
        height: z.number().int(),
        devicePixelRatio: z.number().optional(),
      })
      .optional(),
    pageMeta: z
      .object({
        ogImage: z.string().optional(),
        ogTitle: z.string().optional(),
        description: z.string().max(4000).optional(),
        siteName: z.string().optional(),
        favicon: z.string().optional(),
      })
      .optional(),
    post: z
      .object({
        platform: Platform,
        externalId: z.string().max(64),
        raw: z.unknown().optional(),
        dom: z.record(z.string(), z.unknown()).optional(),
        partial: z.boolean().optional(),
      })
      .optional(),
    collectionId: z.string().nullable().optional(),
    note: z.string().max(5000).optional(),
  })
  .refine((v) => !(v.inlineMedia && v.upload), {
    message: '`inlineMedia` et `upload` sont exclusifs',
  })
export type SaveRequest = z.output<typeof SaveRequest>

export const SaveAck = z.object({
  status: z.enum(['saved', 'duplicate', 'queued', 'error']),
  saveId: z.string().optional(),
  collectionName: z.string().optional(),
  error: z.string().optional(),
})
