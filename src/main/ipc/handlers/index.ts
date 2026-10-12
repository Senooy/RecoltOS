/**
 * FROZEN registry of IPC handlers: one file per domain of `DOMAINS`
 * (`src/shared/ipc/index.ts`). Each domain only fills `handlers/<domain>.ts`.
 */
import type { Domain } from '../../../shared/ipc'
import type { AllHandlers, DomainHandlers } from '../router'
import { aiHandlers } from './ai'
import { bridgeHandlers } from './bridge'
import { captureHandlers } from './capture'
import { collectionsHandlers } from './collections'
import { dataHandlers } from './data'
import { importHandlers } from './import'
import { ingestHandlers } from './ingest'
import { itemsHandlers } from './items'
import { jobsHandlers } from './jobs'
import { librariesHandlers } from './libraries'
import { prefsHandlers } from './prefs'
import { rediscoverHandlers } from './rediscover'
import { searchHandlers } from './search'
import { spacesHandlers } from './spaces'
import { syncHandlers } from './sync'
import { systemHandlers } from './system'
import { tagsHandlers } from './tags'

export const handlersByDomain: { [D in Domain]: DomainHandlers<D> } = {
  items: itemsHandlers,
  collections: collectionsHandlers,
  tags: tagsHandlers,
  search: searchHandlers,
  spaces: spacesHandlers,
  ingest: ingestHandlers,
  import: importHandlers,
  ai: aiHandlers,
  data: dataHandlers,
  prefs: prefsHandlers,
  jobs: jobsHandlers,
  system: systemHandlers,
  sync: syncHandlers,
  bridge: bridgeHandlers,
  capture: captureHandlers,
  rediscover: rediscoverHandlers,
  libraries: librariesHandlers,
}

export const handlers: AllHandlers = Object.assign(
  {},
  ...Object.values(handlersByDomain),
) as AllHandlers
