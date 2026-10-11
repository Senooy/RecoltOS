/**
 * Messages de synchronisation (SYNC §6.1-6.2) en zod. Stub typé créé par WP-00, possédé par WP-51.
 */
import { z } from 'zod'
import { MAX_SYNC_PAGES } from './constants'
import { Platform, Trigger } from './envelope'

export const SyncMode = z.enum(['incremental', 'backfill', 'deep'])

export const SyncRunMessage = z.object({
  runId: z.string(),
  platform: Platform,
  mode: SyncMode,
  trigger: Trigger,
  startCursor: z.string().nullable().optional(),
  maxPages: z.number().int().min(1).max(MAX_SYNC_PAGES),
  hintTabId: z.number().int().optional(),
})

export const SyncPageMessage = z.object({
  runId: z.string().nullable(),
  platform: Platform,
  pageIndex: z.number().int().min(0),
  origin: z.enum(['intercept', 'replay', 'assist']),
  status: z.number().int(),
  headers: z.record(z.string(), z.string()).optional(),
  json: z.unknown(),
})

export const SyncAckMessage = z.object({
  runId: z.string(),
  decision: z.enum(['continue', 'stop']),
  nextCursor: z.string().nullable().optional(),
  delayMs: z.number().int().optional(),
  stats: z
    .object({
      parsed: z.number().int(),
      new: z.number().int(),
      known: z.number().int(),
      dismissed: z.number().int(),
    })
    .partial()
    .optional(),
})

export const SyncFinishedMessage = z.object({
  runId: z.string(),
  status: z.enum([
    'ok',
    'auth_required',
    'rate_limited',
    'api_changed',
    'network',
    'waiting_for_tab',
    'aborted',
  ]),
  error: z.string().optional(),
  resetAt: z.number().int().optional(),
})
