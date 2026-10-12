/**
 * DTOs for sync and bridge (`SyncStatus`, `sync_state`).
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

/**
 * State detail: `blocked` (cookies present but request refused),
 * `permissions` (missing host permissions, Firefox), `not_logged_in` (no session cookie),
 * `browser_closed` (no extension connected), `network`, `budget` (daily quota reached).
 */
export const SyncDetail = z.enum([
  'blocked',
  'permissions',
  'not_logged_in',
  'browser_closed',
  'network',
  'budget',
])
export type SyncDetail = z.output<typeof SyncDetail>

export const SyncSourceStatus = z.object({
  source: SyncSource,
  enabled: z.boolean(),
  allowBackgroundTab: z.boolean(),
  accountHandle: z.string().nullable(),
  status: SyncSourceStatusState,
  detail: SyncDetail.nullable(),
  lastRunAt: z.number().int().nullable(),
  lastSuccessAt: z.number().int().nullable(),
  lastNewCount: z.number().int(),
  lastError: z.string().nullable(),
  totalSynced: z.number().int(),
  backfillDone: z.boolean(),
  cooldownUntil: z.number().int().nullable(),
  /** Current run: pages received and items added. */
  running: z
    .object({ mode: z.string(), pages: z.number().int(), newItems: z.number().int() })
    .nullable(),
  /** Browser syncing this source (label), `null` if none. */
  browser: z.string().nullable(),
  /** Session seen by the extension (`null`: no extension connected). */
  loggedIn: z.boolean().nullable(),
  /** Posts recovered by the backfill, not yet reviewed. */
  recovered: z.number().int(),
  /** Setting carried over from GatherOS at import (offered, never applied on its own). */
  importedFlag: z.boolean().nullable(),
  nextRunAt: z.number().int().nullable(),
})
export type SyncSourceStatus = z.output<typeof SyncSourceStatus>

/** Platform state seen by a connected extension (never a cookie or token). */
export const ClientPlatformState = z.object({
  loggedIn: z.boolean(),
  /** Host permissions (Firefox MV3); `null` = not applicable. */
  permission: z.boolean().nullable(),
  handle: z.string().nullable(),
})

export const BridgeClient = z.object({
  /** Browser ID (`firefox`, `chrome`, `brave`…), from the wrapper. */
  browser: z.string(),
  /** Displayed label (« Firefox », « Chrome »…). */
  label: z.string(),
  target: z.enum(['chromium', 'firefox']).nullable(),
  extVersion: z.string().nullable(),
  connectedAt: z.number().int(),
  profileId: z.string().nullable(),
  platforms: z
    .object({ x: ClientPlatformState, instagram: ClientPlatformState, cosmos: ClientPlatformState })
    .nullable(),
  /** Extension older than the bundled one (`ext.stale`). */
  stale: z.boolean(),
})
export type BridgeClient = z.output<typeof BridgeClient>

export const SyncStatus = z.object({
  sources: z.array(SyncSourceStatus),
  clients: z.array(BridgeClient),
  /** GatherOS (sync or extension) active: warning, blocking for Instagram. */
  gatherosConflict: z.boolean(),
  /** An extension is connected: sync only runs while the browser is open. */
  browserConnected: z.boolean(),
  /** Bridge stopped (e2e tests without `RECOLTOS_BRIDGE`). */
  bridgeRunning: z.boolean(),
})
export type SyncStatus = z.output<typeof SyncStatus>

export const SyncRunInfo = z.object({
  id: z.string(),
  source: SyncSource,
  mode: z.string(),
  reason: z.string(),
  browser: z.string().nullable(),
  target: z.string().nullable(),
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
  kind: z.enum(['chromium', 'firefox']),
  installed: z.boolean(),
  hostInstalled: z.boolean(),
  unverified: z.boolean(),
})
export type BrowserInfo = z.output<typeof BrowserInfo>

export const GatherOSPresence = z.object({
  appInstalled: z.boolean(),
  appRunning: z.boolean(),
  hostManifests: z.array(z.object({ browser: z.string(), path: z.string() })),
  syncFlags: z
    .object({
      x: z.boolean().nullable(),
      instagram: z.boolean().nullable(),
      cosmos: z.boolean().nullable(),
    })
    .nullable(),
  /** Blocking warning before enabling Instagram. */
  blocksInstagram: z.boolean(),
})
export type GatherOSPresence = z.output<typeof GatherOSPresence>

export const ExtensionInfo = z.object({
  bundledVersion: z.string(),
  extensionId: z.string(),
  geckoId: z.string(),
  /** Folder to load in Chrome / Brave / Edge / Vivaldi (developer mode). */
  chromiumDir: z.string().nullable(),
  /** `manifest.json` folder for temporary loading in Firefox. */
  firefoxDir: z.string().nullable(),
  /** Signed Firefox extension (`.xpi`), if `pnpm run sign:firefox` was run. */
  firefoxXpi: z.string().nullable(),
})
export type ExtensionInfo = z.output<typeof ExtensionInfo>
