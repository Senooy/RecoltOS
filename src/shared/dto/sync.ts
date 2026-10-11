/**
 * DTO synchronisation et bridge (PLAN §4.3 `SyncStatus`, SYNC §6.3 `sync_state`).
 */
import { z } from 'zod'
import { SyncSource } from '../enums'

export const SyncSourceStatusState = z.enum([
  'idle',
  'running',
  'ok',
  'auth_required',
  'rate_limited',
  'api_changed',
  'waiting_for_tab',
  'no_browser',
  'error',
])

export const SyncSourceStatus = z.object({
  source: SyncSource,
  enabled: z.boolean(),
  allowBackgroundTab: z.boolean(),
  accountHandle: z.string().nullable(),
  status: SyncSourceStatusState,
  lastRunAt: z.number().int().nullable(),
  lastSuccessAt: z.number().int().nullable(),
  lastNewCount: z.number().int(),
  lastError: z.string().nullable(),
  totalSynced: z.number().int(),
  backfillDone: z.boolean(),
  cooldownUntil: z.number().int().nullable(),
})
export type SyncSourceStatus = z.output<typeof SyncSourceStatus>

export const BridgeClient = z.object({
  browser: z.string(),
  extVersion: z.string().nullable(),
  connectedAt: z.number().int(),
  profileId: z.string().nullable(),
})
export type BridgeClient = z.output<typeof BridgeClient>

export const SyncStatus = z.object({
  sources: z.array(SyncSourceStatus),
  clients: z.array(BridgeClient),
  /** GatherOS (sync ou extension) actif : la sync RecoltOS est bloquée (PLAN §9.1). */
  gatherosConflict: z.boolean(),
})
export type SyncStatus = z.output<typeof SyncStatus>

export const SyncRunInfo = z.object({
  id: z.string(),
  source: SyncSource,
  mode: z.string(),
  reason: z.string(),
  startedAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
  pages: z.number().int(),
  newItems: z.number().int(),
  knownItems: z.number().int(),
  status: z.string().nullable(),
  error: z.string().nullable(),
})
export type SyncRunInfo = z.output<typeof SyncRunInfo>

export const BrowserInfo = z.object({
  id: z.string(),
  name: z.string(),
  installed: z.boolean(),
  hostInstalled: z.boolean(),
})
export type BrowserInfo = z.output<typeof BrowserInfo>
