/**
 * Item DTOs. Built by main; media URLs are already resolved
 * (`recolt://`, fallback `thumb ?? legacyThumb ?? display ?? original`).
 * No http(s) resource URL: `sourceUrl` is a link shown/opened, never loaded.
 */
import { z } from 'zod'
import {
  AiState,
  HexColor,
  ItemKind,
  MediaStatus,
  MediaType,
  MediaUrl,
  Source,
  Uuid,
} from '../enums'
import { POST_VIEW_TEXT_MAX } from '../post-meta'

export const PostAuthorView = z.object({
  name: z.string().nullable(),
  /** Without '@'. */
  handle: z.string().nullable(),
  /** `null` → monogram (expired Instagram avatars). */
  avatarUrl: MediaUrl.nullable(),
})
export type PostAuthorView = z.output<typeof PostAuthorView>

export const QuotedPostView = z.object({
  author: PostAuthorView.nullable(),
  text: z.string().nullable(),
  imageUrls: z.array(MediaUrl),
})
export type QuotedPostView = z.output<typeof QuotedPostView>

/** Post view for a grid card. */
export const PostView = z.object({
  author: PostAuthorView,
  text: z.string().max(POST_VIEW_TEXT_MAX).nullable(),
  quoted: QuotedPostView.nullable(),
  threadCount: z.number().int().min(0),
})
export type PostView = z.output<typeof PostView>

/** Full view for the detail (thread and quoted post in full). */
export const PostDetailView = PostView.extend({
  text: z.string().nullable(),
  postedAt: z.number().int().nullable(),
  thread: z.array(z.object({ text: z.string(), imageUrls: z.array(MediaUrl) })),
})
export type PostDetailView = z.output<typeof PostDetailView>

export const ItemCard = z.object({
  uuid: Uuid,
  kind: ItemKind,
  source: Source,
  title: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  mediaCount: z.number().int().min(0),
  mime: z.string().nullable(),
  isAnimated: z.boolean(),
  durationMs: z.number().int().nullable(),
  /** `palette[0]` (loading background), otherwise `null` → `--skeleton`. */
  dominant: HexColor.nullable(),
  hasNotes: z.boolean(),
  createdAt: z.number().int(),
  /** = `createdAt` (the UI shows the date added). */
  displayDate: z.number().int(),
  viewCount: z.number().int().min(0),
  thumbUrl: MediaUrl.nullable(),
  largeUrl: MediaUrl.nullable(),
  posterUrl: MediaUrl.nullable(),
  /** `null` while the derivative is missing. */
  previewUrl: MediaUrl.nullable(),
  originalUrl: MediaUrl.nullable(),
  post: PostView.nullable(),
  /** Host of `source_url` ("reddit.com") for `PageCard`: a host name, never a URL. */
  sourceHost: z.string().max(253).nullable().default(null),
})
export type ItemCard = z.output<typeof ItemCard>

export const Slide = z.object({
  uuid: Uuid,
  type: MediaType,
  status: MediaStatus,
  thumbUrl: MediaUrl.nullable(),
  largeUrl: MediaUrl.nullable(),
  originalUrl: MediaUrl.nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
})
export type Slide = z.output<typeof Slide>

export const NamedRef = z.object({ uuid: Uuid, name: z.string() })
export type NamedRef = z.output<typeof NamedRef>

export const ItemDetail = ItemCard.extend({
  notes: z.string().nullable(),
  /** Original link (shown, opened via `system.openExternal`), never loaded by the renderer. */
  sourceUrl: z.string().nullable(),
  externalId: z.string().nullable(),
  post: PostDetailView.nullable(),
  slides: z.array(Slide),
  collections: z.array(NamedRef),
  tags: z.array(NamedRef),
  palette: z.array(HexColor).nullable(),
  ocrText: z.string().nullable(),
  aiDescription: z.string().nullable(),
  aiPrompt: z.string().nullable(),
  aiState: AiState,
  aiProvider: z.string().nullable(),
  aiLang: z.string().nullable(),
  fileSize: z.number().int().nullable(),
  addedAt: z.number().int(),
  hiddenAt: z.number().int().nullable(),
  deletedAt: z.number().int().nullable(),
  aiExcluded: z.boolean(),
  /** Most recent active AI job (shimmer in the Details panel). */
  aiJob: z
    .object({ type: z.enum(['ai.enrich', 'ai.prompt']), state: z.enum(['queued', 'running']) })
    .nullable()
    .default(null),
  /** Last AI error (item in `failed`, or job waiting on a provider). */
  aiError: z.object({ code: z.string(), message: z.string() }).nullable().default(null),
})
export type ItemDetail = z.output<typeof ItemDetail>

export const ItemsPage = z.object({
  items: z.array(ItemCard),
  /** Opaque keyset cursor (base64url), `null` at the end of the list. */
  nextCursor: z.string().nullable(),
  total: z.number().int().min(0),
})
export type ItemsPage = z.output<typeof ItemsPage>

/** Counts per tab (also used outside the tabs). */
export const TabCounts = z.object({
  all: z.number().int(),
  saved: z.number().int(),
  unsorted: z.number().int(),
  trash: z.number().int(),
  hidden: z.number().int(),
})
export type TabCounts = z.output<typeof TabCounts>

export const IngestReport = z.object({
  added: z.array(z.object({ itemUuid: Uuid, path: z.string().optional() })),
  duplicates: z.array(z.object({ itemUuid: Uuid, path: z.string().optional() })),
  failed: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })),
})
export type IngestReport = z.output<typeof IngestReport>

export const IngestProgress = z.object({
  done: z.number().int(),
  total: z.number().int(),
  current: z.string().nullable(),
})
export type IngestProgress = z.output<typeof IngestProgress>
