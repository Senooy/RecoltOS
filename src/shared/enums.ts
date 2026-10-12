/**
 * Shared enums and zod primitives.
 * No `electron` nor `node:*` import in `src/shared/**`.
 */
import { z } from 'zod'
import './zod-locale'

/** Strict RFC UUID: GatherOS ids and `crypto.randomUUID()` comply. */
export const Uuid = z.uuid()
export type Uuid = z.output<typeof Uuid>

/** List sort. `viewed` = recently viewed, `mostViewed` = most viewed. */
export const SORT_MODES = [
  'recent',
  'oldest',
  'name',
  'color',
  'viewed',
  'mostViewed',
  'random',
] as const
export const SortMode = z.enum(SORT_MODES)
export type SortMode = z.output<typeof SortMode>

/** Library tabs. */
export const LIBRARY_TABS = ['all', 'saved', 'unsorted', 'trash', 'hidden'] as const
export const LibraryTab = z.enum(LIBRARY_TABS)
export type LibraryTab = z.output<typeof LibraryTab>

/** Origin of an item (`items.source`). */
export const SOURCES = ['local', 'capture', 'web', 'x', 'instagram', 'cosmos'] as const
export const Source = z.enum(SOURCES)
export type Source = z.output<typeof Source>

/** Sources synced by the extension (virtual chips `#x #instagram #cosmos`). */
export const SYNC_SOURCES = ['x', 'instagram', 'cosmos'] as const
export const SyncSource = z.enum(SYNC_SOURCES)
export type SyncSource = z.output<typeof SyncSource>

export const ITEM_KINDS = ['image', 'video', 'tweet', 'url'] as const
export const ItemKind = z.enum(ITEM_KINDS)
export type ItemKind = z.output<typeof ItemKind>

export const MediaType = z.enum(['image', 'video'])
export type MediaType = z.output<typeof MediaType>

export const MediaStatus = z.enum(['ok', 'processing', 'remote', 'missing', 'failed'])
export type MediaStatus = z.output<typeof MediaStatus>

export const AiState = z.enum(['none', 'queued', 'done', 'failed', 'skipped'])
export type AiState = z.output<typeof AiState>

export const Theme = z.enum(['light', 'dark', 'system'])
export type Theme = z.output<typeof Theme>

/** Color `#rrggbb`. */
export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'couleur #rrggbb attendue')
export type HexColor = z.output<typeof HexColor>

/** Timestamp in epoch milliseconds. */
export const EpochMs = z.number().int().nonnegative()

/** Library identifier, compatible with a host name. */
export const LibraryId = z.string().regex(/^[a-z0-9-]{1,40}$/, 'invalid library identifier')
export type LibraryId = z.output<typeof LibraryId>

/**
 * Media URL rendered to the renderer: always `recolt://<libraryId>/<root>/<rel>?v=<n>`.
 * The renderer NEVER receives an http(s) URL.
 */
export const MEDIA_ROOTS = [
  'items',
  'thumbs',
  'large',
  'posters',
  'previews',
  'display',
  'avatars',
  'remote',
  'spaces',
] as const
export type MediaRoot = (typeof MEDIA_ROOTS)[number]
/**
 * Shape: `recolt://<libraryId>/<root>/<rel>[?…]`, `root` ∈ MEDIA_ROOTS, no fragment nor
 * backslash; the query contains only safe characters (`?v=<n>` in production, or the
 * `w=&h=&c=` hints of the mockup). No `.` or `..` segment (root bypass).
 * The real revalidation (realpath, root) stays on the main side (handlers).
 */
const MEDIA_URL_RE = new RegExp(
  `^recolt://[a-z0-9-]{1,40}/(?:${MEDIA_ROOTS.join('|')})/[^?#\\\\\\s]+(?:\\?[A-Za-z0-9=&._-]*)?$`,
)
export const MediaUrl = z
  .string()
  .regex(MEDIA_URL_RE, 'recolt:// URL expected')
  .refine((u) => !(u.split('?')[0] ?? '').split('/').some((seg) => seg === '.' || seg === '..'), {
    message: 'forbidden path segment (. or ..)',
  })
  // Encodings and empty segments: `%2e%2e`, `..%2f`, `%5c` and `//` bypass the
  // literal check. The real defense stays on the main side (decoding, realpath, root).
  .refine(
    (u) => {
      const pathPart = (u.split('?')[0] ?? '').slice('recolt://'.length)
      if (/%(2e|2f|5c)/i.test(pathPart)) return false
      return !pathPart.split('/').some((seg) => seg === '')
    },
    { message: 'encoding or empty segment forbidden in the path' },
  )
export type MediaUrl = z.output<typeof MediaUrl>

/** Web URL typed by the user or opened in the browser (never loaded by the renderer). */
export const WebUrl = z.url({ protocol: /^https?$/ })
