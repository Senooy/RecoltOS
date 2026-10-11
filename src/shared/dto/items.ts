/**
 * DTO des éléments (PLAN §4.3). Construits par main ; les URL média sont déjà résolues
 * (`recolt://`, repli `thumb ?? legacyThumb ?? display ?? original`, PLAN §1.7).
 * Aucune URL http(s) de ressource : `sourceUrl` est un lien affiché/ouvert, jamais chargé.
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
  /** Sans '@'. */
  handle: z.string().nullable(),
  /** `null` → monogramme (avatars Instagram expirés, PLAN §9.4). */
  avatarUrl: MediaUrl.nullable(),
})
export type PostAuthorView = z.output<typeof PostAuthorView>

export const QuotedPostView = z.object({
  author: PostAuthorView.nullable(),
  text: z.string().nullable(),
  imageUrls: z.array(MediaUrl),
})
export type QuotedPostView = z.output<typeof QuotedPostView>

/** Vue de post pour une carte de grille (PLAN §1.2, §4.3). */
export const PostView = z.object({
  author: PostAuthorView,
  text: z.string().max(POST_VIEW_TEXT_MAX).nullable(),
  quoted: QuotedPostView.nullable(),
  threadCount: z.number().int().min(0),
})
export type PostView = z.output<typeof PostView>

/** Vue complète pour le détail (fil et post cité en entier). */
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
  /** `palette[0]` (fond de chargement), sinon `null` → `--skeleton`. */
  dominant: HexColor.nullable(),
  hasNotes: z.boolean(),
  createdAt: z.number().int(),
  /** = `createdAt` (l'UI affiche la date d'ajout). */
  displayDate: z.number().int(),
  viewCount: z.number().int().min(0),
  thumbUrl: MediaUrl.nullable(),
  largeUrl: MediaUrl.nullable(),
  posterUrl: MediaUrl.nullable(),
  /** `null` tant que le dérivé manque. */
  previewUrl: MediaUrl.nullable(),
  originalUrl: MediaUrl.nullable(),
  post: PostView.nullable(),
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
  /** Lien d'origine (affiché, ouvert via `system.openExternal`), jamais chargé par le renderer. */
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
})
export type ItemDetail = z.output<typeof ItemDetail>

export const ItemsPage = z.object({
  items: z.array(ItemCard),
  /** Curseur keyset opaque (base64url), `null` en fin de liste. */
  nextCursor: z.string().nullable(),
  total: z.number().int().min(0),
})
export type ItemsPage = z.output<typeof ItemsPage>

/** Comptes par onglet (servent ailleurs que dans les onglets, ERRATA §C). */
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
