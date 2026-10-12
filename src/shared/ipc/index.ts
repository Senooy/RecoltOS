/**
 * Contrat IPC agrégé : un canal Electron `rpc` + des événements `evt:<nom>`.
 * Un fichier par domaine (`ipc/<domaine>.ts`) ; la liste des domaines est FIGÉE ici et
 * reproduite par `src/main/ipc/handlers/index.ts`. Main valide toujours les entrées et, en dev,
 * les sorties.
 */
import type { z } from 'zod'
import { aiContract, aiEvents } from './ai'
import { bridgeContract } from './bridge'
import { captureContract, captureEvents } from './capture'
import { collectionsContract, collectionsEvents } from './collections'
import { dataContract, dataEvents } from './data'
import { importContract, importEvents } from './import'
import { ingestContract, ingestEvents } from './ingest'
import { itemsContract, itemsEvents } from './items'
import { jobsContract, jobsEvents } from './jobs'
import { librariesContract } from './libraries'
import { prefsContract, prefsEvents } from './prefs'
import { rediscoverContract } from './rediscover'
import { searchContract } from './search'
import { spacesContract, spacesEvents } from './spaces'
import { syncContract, syncEvents } from './sync'
import { systemContract, systemEvents } from './system'
import { tagsContract } from './tags'

export * from './channels'
export type { ChannelDef, ContractShape, EventShape } from './define'

/** Domaines IPC (liste figée, ordre = ordre d'enregistrement). Pas de domaine `embed`. */
export const DOMAINS = [
  'items',
  'collections',
  'tags',
  'search',
  'spaces',
  'ingest',
  'import',
  'ai',
  'data',
  'prefs',
  'jobs',
  'system',
  'sync',
  'bridge',
  'capture',
  'rediscover',
  'libraries',
] as const
export type Domain = (typeof DOMAINS)[number]

export const contractsByDomain = {
  items: itemsContract,
  collections: collectionsContract,
  tags: tagsContract,
  search: searchContract,
  spaces: spacesContract,
  ingest: ingestContract,
  import: importContract,
  ai: aiContract,
  data: dataContract,
  prefs: prefsContract,
  jobs: jobsContract,
  system: systemContract,
  sync: syncContract,
  bridge: bridgeContract,
  capture: captureContract,
  rediscover: rediscoverContract,
  libraries: librariesContract,
} as const satisfies Record<Domain, unknown>

export const contract = {
  ...itemsContract,
  ...collectionsContract,
  ...tagsContract,
  ...searchContract,
  ...spacesContract,
  ...ingestContract,
  ...importContract,
  ...aiContract,
  ...dataContract,
  ...prefsContract,
  ...jobsContract,
  ...systemContract,
  ...syncContract,
  ...bridgeContract,
  ...captureContract,
  ...rediscoverContract,
  ...librariesContract,
} as const

export type Contract = typeof contract
export type Channel = keyof Contract
/** Ce que l'appelant envoie (défauts optionnels). */
export type In<C extends Channel> = z.input<Contract[C]['input']>
/** Ce que le handler reçoit après validation (défauts appliqués). */
export type Parsed<C extends Channel> = z.output<Contract[C]['input']>
export type Out<C extends Channel> = z.output<Contract[C]['output']>
export type ChannelOf<D extends Domain> = Extract<Channel, `${D}.${string}`>

export const CHANNELS = Object.keys(contract) as Channel[]

export function isChannel(v: unknown): v is Channel {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(contract, v)
}

/** Domaine d'un canal = premier segment (`import.gatheros.start` → `import`). */
export function domainOf(channel: string): string {
  const i = channel.indexOf('.')
  return i === -1 ? channel : channel.slice(0, i)
}

export const events = {
  ...itemsEvents,
  ...collectionsEvents,
  ...spacesEvents,
  ...ingestEvents,
  ...importEvents,
  ...aiEvents,
  ...dataEvents,
  ...prefsEvents,
  ...jobsEvents,
  ...systemEvents,
  ...syncEvents,
  ...captureEvents,
} as const

export type Events = typeof events
export type EventName = keyof Events
export type EventPayload<E extends EventName> = z.output<Events[E]>
export const EVENT_NAMES = Object.keys(events) as EventName[]

export function isEventName(v: unknown): v is EventName {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(events, v)
}

export { ItemFilters, ItemsListInput } from './items'
export { ApplyBatchInput } from './spaces'
export { ImportProgress, ImportReport } from './import'
export { LibraryInfo } from './libraries'
export { RESERVED_TAG_NAMES } from './tags'
export { MenuCommandSchema, EditCommand } from './system'
