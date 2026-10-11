/**
 * Messages de synchronisation (SYNC §6.1-6.2, ERRATA §G.2) en zod. Possédé par WP-51.
 */
import { z } from 'zod'
import { MAX_SYNC_PAGES, MAX_WANTED_AUTHORS } from './constants'
import { Platform, Trigger } from './envelope'

export const SyncMode = z.enum(['incremental', 'backfill', 'deep'])
export type SyncMode = z.output<typeof SyncMode>

/** Où le run s'exécute : arrière-plan de l'extension (défaut), onglet existant ou créé (repli). */
export const SyncTarget = z.enum(['background', 'tab', 'created_tab'])
export type SyncTarget = z.output<typeof SyncTarget>

export const SyncRunMessage = z.object({
  runId: z.string().min(1).max(64),
  platform: Platform,
  mode: SyncMode,
  trigger: Trigger,
  startCursor: z.string().max(4096).nullable().optional(),
  maxPages: z.number().int().min(1).max(MAX_SYNC_PAGES),
  hintTabId: z.number().int().optional(),
  /** Repli « Ouvrir un onglet en arrière-plan si besoin » autorisé pour ce run. */
  allowBackgroundTab: z.boolean().optional(),
})
export type SyncRunMessage = z.output<typeof SyncRunMessage>

export const SyncPageMessage = z.object({
  runId: z.string().nullable(),
  platform: Platform,
  pageIndex: z.number().int().min(0),
  origin: z.enum(['intercept', 'replay', 'assist']),
  status: z.number().int(),
  /** `x-rate-limit-*` et `content-type` seulement : jamais d'en-tête d'authentification. */
  headers: z.record(z.string(), z.string()).optional(),
  json: z.unknown(),
  target: SyncTarget.optional(),
})
export type SyncPageMessage = z.output<typeof SyncPageMessage>

export const SyncStats = z.object({
  parsed: z.number().int(),
  new: z.number().int(),
  known: z.number().int(),
  dismissed: z.number().int(),
})

/** Issue d'un run (SYNC §6.1 + `blocked` / `permissions`, ERRATA §G.2). */
export const SyncOutcome = z.enum([
  'ok',
  'auth_required',
  'rate_limited',
  'api_changed',
  'network',
  'waiting_for_tab',
  'aborted',
  /** Cookies de session présents mais requête refusée (401/403). */
  'blocked',
  /** Autorisations d'hôte manquantes (Firefox MV3). */
  'permissions',
])
export type SyncOutcome = z.output<typeof SyncOutcome>

export const SyncAckMessage = z.object({
  runId: z.string(),
  decision: z.enum(['continue', 'stop']),
  nextCursor: z.string().nullable().optional(),
  delayMs: z.number().int().min(0).optional(),
  stats: SyncStats.partial().optional(),
  /** Sur `stop` décidé par l'app (page refusée, plafond, checkpoint…). */
  outcome: SyncOutcome.optional(),
})
export type SyncAckMessage = z.output<typeof SyncAckMessage>

export const SyncFinishedMessage = z.object({
  runId: z.string(),
  status: SyncOutcome,
  error: z.string().max(2000).optional(),
  resetAt: z.number().int().optional(),
  pages: z.number().int().min(0).optional(),
  target: SyncTarget.optional(),
})
export type SyncFinishedMessage = z.output<typeof SyncFinishedMessage>

export const SyncCancelMessage = z.object({ runId: z.string() })

export const SyncHintMessage = z.object({
  platform: Platform,
  reason: z.literal('native_save'),
  tabId: z.number().int().optional(),
})

export const SyncRequestMessage = z.object({
  platform: Platform.optional(),
  trigger: z.enum(['manual', 'schedule']).default('manual'),
})

export const CapturePassiveMessage = z.object({
  platform: Platform,
  op: z.string().max(64),
  status: z.number().int(),
  json: z.unknown(),
  tabUrl: z.string().max(8192).optional(),
})

export const ItemRefreshMessage = z.object({ platform: Platform, externalId: z.string().max(64) })
export const ItemDataMessage = z.object({
  platform: Platform,
  externalId: z.string().max(64),
  status: z.number().int().optional(),
  json: z.unknown(),
})

export const AuthorRef = z.object({ platform: Platform, handle: z.string().max(100) })
export const AuthorsWantedMessage = z.object({
  authors: z.array(AuthorRef).max(MAX_WANTED_AUTHORS),
})
export const AuthorSeenMessage = z.object({
  platform: Platform,
  handle: z.string().max(100),
  name: z.string().max(200).nullable().optional(),
  avatarUrl: z.string().max(4096).nullable().optional(),
})
