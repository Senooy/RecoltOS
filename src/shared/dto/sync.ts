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

/** État d'une plateforme vu par une extension connectée (jamais de cookie ni de jeton). */
export const ClientPlatformState = z.object({
  loggedIn: z.boolean(),
  /** Autorisations d'hôte (Firefox MV3) ; `null` = sans objet. */
  permission: z.boolean().nullable(),
  handle: z.string().nullable(),
})

export const BridgeClient = z.object({
  /** Identifiant du navigateur (`firefox`, `chrome`, `brave`…), d'après le wrapper. */
  browser: z.string(),
  /** Libellé affiché (« Firefox », « Chrome »…). */
  label: z.string(),
  target: z.enum(['chromium', 'firefox']).nullable(),
  extVersion: z.string().nullable(),
  connectedAt: z.number().int(),
  profileId: z.string().nullable(),
  platforms: z
    .object({ x: ClientPlatformState, instagram: ClientPlatformState, cosmos: ClientPlatformState })
    .nullable(),
  /** Extension plus ancienne que celle livrée (`ext.stale`). */
  stale: z.boolean(),
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
  /** Avertissement bloquant avant d'activer Instagram (SYNC §1.9). */
  blocksInstagram: z.boolean(),
})
export type GatherOSPresence = z.output<typeof GatherOSPresence>

export const ExtensionInfo = z.object({
  bundledVersion: z.string(),
  extensionId: z.string(),
  geckoId: z.string(),
  /** Dossier à charger dans Chrome / Brave / Edge / Vivaldi (mode développeur). */
  chromiumDir: z.string().nullable(),
  /** Dossier `manifest.json` pour le chargement temporaire dans Firefox. */
  firefoxDir: z.string().nullable(),
  /** Extension Firefox signée (`.xpi`), si `pnpm run sign:firefox` a été fait. */
  firefoxXpi: z.string().nullable(),
})
export type ExtensionInfo = z.output<typeof ExtensionInfo>
