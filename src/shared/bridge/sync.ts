/**
 * Sync messages in zod.
 */
import { z } from 'zod'
import { MAX_SYNC_PAGES, MAX_WANTED_AUTHORS } from './constants'
import { Platform, Trigger } from './envelope'

export const SyncMode = z.enum(['incremental', 'backfill', 'deep'])
export type SyncMode = z.output<typeof SyncMode>

/** Where the run executes: extension background (default), an existing or created tab (fallback). */
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
  /** "Open a background tab if needed" fallback allowed for this run. */
  allowBackgroundTab: z.boolean().optional(),
})
export type SyncRunMessage = z.output<typeof SyncRunMessage>

export const SyncPageMessage = z.object({
  runId: z.string().nullable(),
  platform: Platform,
  pageIndex: z.number().int().min(0),
  origin: z.enum(['intercept', 'replay', 'assist']),
  status: z.number().int(),
  /** `x-rate-limit-*` and `content-type` only: never an authentication header. */
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

/** Outcome of a run (`blocked` / `permissions`). */
export const SyncOutcome = z.enum([
  'ok',
  'auth_required',
  'rate_limited',
  'api_changed',
  'network',
  'waiting_for_tab',
  'aborted',
  /** Session cookies present but request refused (401/403). */
  'blocked',
  /** Missing host permissions (Firefox MV3). */
  'permissions',
])
export type SyncOutcome = z.output<typeof SyncOutcome>

export const SyncAckMessage = z.object({
  runId: z.string(),
  decision: z.enum(['continue', 'stop']),
  nextCursor: z.string().nullable().optional(),
  delayMs: z.number().int().min(0).optional(),
  stats: SyncStats.partial().optional(),
  /** On `stop` decided by the app (page refused, cap, checkpoint...). */
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

/** Sync state per platform, pushed by the app (extension popup). */
export const SyncSourceState = z.object({
  enabled: z.boolean(),
  status: z.string().max(40),
  lastSuccessAt: z.number().int().nullable(),
  detail: z.string().max(80).nullable(),
})
export const SyncStateMessage = z.object({
  sources: z.object({ x: SyncSourceState, instagram: SyncSourceState, cosmos: SyncSourceState }),
})
export type SyncStateMessage = z.output<typeof SyncStateMessage>
