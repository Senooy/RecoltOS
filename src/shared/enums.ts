/**
 * Énumérations et primitives zod partagées (PLAN §1.22, §4.3, §4.4 ; ARCHI §2.3).
 * Aucun import `electron` ni `node:*` dans `src/shared/**` (QA §2.4).
 */
import { z } from 'zod'

/** UUID RFC strict : ids GatherOS et `crypto.randomUUID()` sont conformes. */
export const Uuid = z.uuid()
export type Uuid = z.output<typeof Uuid>

/** Tri de liste (PLAN §1.22). `viewed` = consultés récemment, `mostViewed` = les plus consultés. */
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

/** Onglets de la Bibliothèque (DESIGN §3.1). */
export const LIBRARY_TABS = ['all', 'saved', 'unsorted', 'trash', 'hidden'] as const
export const LibraryTab = z.enum(LIBRARY_TABS)
export type LibraryTab = z.output<typeof LibraryTab>

/** Provenance d'un élément (`items.source`). */
export const SOURCES = ['local', 'capture', 'web', 'x', 'instagram', 'cosmos'] as const
export const Source = z.enum(SOURCES)
export type Source = z.output<typeof Source>

/** Sources synchronisées par l'extension (chips virtuelles `#x #instagram #cosmos`). */
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

/** Couleur `#rrggbb`. */
export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'couleur #rrggbb attendue')
export type HexColor = z.output<typeof HexColor>

/** Horodatage en millisecondes epoch. */
export const EpochMs = z.number().int().nonnegative()

/** Identifiant de bibliothèque, compatible avec un nom d'hôte (ARCHI §2.5). */
export const LibraryId = z
  .string()
  .regex(/^[a-z0-9-]{1,40}$/, 'identifiant de bibliothèque invalide')
export type LibraryId = z.output<typeof LibraryId>

/**
 * URL média rendue au renderer : toujours `recolt://<libraryId>/<root>/<rel>?v=<n>` (PLAN §1.7).
 * Le renderer ne reçoit JAMAIS d'URL http(s) (PLAN §2.4).
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
export const MediaUrl = z.string().regex(/^recolt:\/\/[a-z0-9-]+\//, 'URL recolt:// attendue')
export type MediaUrl = z.output<typeof MediaUrl>

/** URL web saisie par l'utilisateur ou ouverte dans le navigateur (jamais chargée par le renderer). */
export const WebUrl = z.url({ protocol: /^https?$/ })
