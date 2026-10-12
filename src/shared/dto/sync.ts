/**
 * DTO synchronisation et bridge (`SyncStatus`, `sync_state`).
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
 * Précision de l'état : `blocked` (cookies présents mais requête refusée),
 * `permissions` (autorisations d'hôte manquantes, Firefox), `not_logged_in` (aucun cookie de session),
 * `browser_closed` (aucune extension connectée), `network`, `budget` (quota du jour atteint).
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
  /** Run en cours : pages reçues et éléments ajoutés. */
  running: z
    .object({ mode: z.string(), pages: z.number().int(), newItems: z.number().int() })
    .nullable(),
  /** Navigateur qui synchronise cette source (libellé), `null` si aucun. */
  browser: z.string().nullable(),
  /** Session vue par l'extension (`null` : aucune extension connectée). */
  loggedIn: z.boolean().nullable(),
  /** Publications rattrapées par le backfill, pas encore revues. */
  recovered: z.number().int(),
  /** Réglage repris de GatherOS à l'import (proposé, jamais appliqué seul). */
  importedFlag: z.boolean().nullable(),
  nextRunAt: z.number().int().nullable(),
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
  /** GatherOS (sync ou extension) actif : avertissement, bloquant pour Instagram. */
  gatherosConflict: z.boolean(),
  /** Une extension est connectée : la sync ne tourne que navigateur ouvert. */
  browserConnected: z.boolean(),
  /** Pont arrêté (tests e2e sans `RECOLTOS_BRIDGE`). */
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
  /** Avertissement bloquant avant d'activer Instagram. */
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
