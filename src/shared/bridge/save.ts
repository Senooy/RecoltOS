/**
 * `SaveRequest`, acknowledgement, chunked send and collections.
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
    message: '`inlineMedia` and `upload` are mutually exclusive',
  })
export type SaveRequest = z.output<typeof SaveRequest>

export const SaveAck = z.object({
  status: z.enum(['saved', 'duplicate', 'queued', 'error']),
  /** `uuid` of the item created or found. */
  saveId: z.string().optional(),
  collectionName: z.string().optional(),
  error: z.string().optional(),
})
export type SaveAck = z.output<typeof SaveAck>

/** Binary chunk (base64): sending a file > 8 MiB (`upload.id`) or `media.fetch` proxy (`jobId`). */
export const MediaChunkMessage = z.object({
  jobId: z.string().min(1).max(64),
  seq: z.number().int().min(0),
  last: z.boolean(),
  mime: z.string().max(100).optional(),
  data: z.string().max(MAX_INLINE_BASE64_CHARS),
  /** Failure on the extension side (proxy): no further chunk will follow. */
  error: z.string().max(500).optional(),
})
export type MediaChunkMessage = z.output<typeof MediaChunkMessage>

export const MediaFetchMessage = z.object({
  jobId: z.string().min(1).max(64),
  url: z.url().max(8192),
  referer: z.string().max(8192).optional(),
})

export const BridgeCollection = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  parentId: z.string().nullable(),
  count: z.number().int(),
})
export type BridgeCollection = z.output<typeof BridgeCollection>

export const CollectionsListResult = z.object({
  collections: z.array(BridgeCollection).max(2000),
  /** `collection.create`: id of the created collection. */
  createdId: z.string().optional(),
})
export const CollectionCreateMessage = z.object({
  name: z.string().trim().min(1).max(200),
  color: z.string().max(20).optional(),
})
