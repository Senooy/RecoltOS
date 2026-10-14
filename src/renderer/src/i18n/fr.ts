/**
 * Aggregator of the FR texts: `fr/base.ts` + one file per UI domain,
 * FROZEN list below. Each domain file exports an object of namespaces.
 * The English catalogue (`en.ts`, `en/<domain>.ts`) has exactly the same keys; components
 * read the active language via `tr` (`i18n/index.ts`), never `fr` directly.
 */
import { ai } from './fr/ai'
import { base } from './fr/base'
import { capture } from './fr/capture'
import { collection } from './fr/collection'
import { color } from './fr/color'
import { grid } from './fr/grid'
import { library } from './fr/library'
import { palette } from './fr/palette'
import { rediscover } from './fr/rediscover'
import { search } from './fr/search'
import { settings } from './fr/settings'
import { settingsMore } from './fr/settings-more'
import { shelf } from './fr/shelf'
import { shell } from './fr/shell'
import { spaces } from './fr/spaces'
import { spacesExtra } from './fr/spaces-extra'
import { sync } from './fr/sync'
import { updates } from './fr/updates'
import { viewer } from './fr/viewer'

export const I18N_DOMAINS = [
  'shell',
  'grid',
  'library',
  'settings',
  'collection',
  'shelf',
  'search',
  'palette',
  'settings-more',
  'viewer',
  'color',
  'rediscover',
  'capture',
  'ai',
  'sync',
  'spaces',
  'spaces-extra',
  'updates',
] as const

export const fr = {
  ...base,
  ...shell,
  ...grid,
  ...library,
  ...settings,
  ...collection,
  ...shelf,
  ...search,
  ...palette,
  ...settingsMore,
  ...viewer,
  ...color,
  ...rediscover,
  ...capture,
  ...ai,
  ...sync,
  ...spaces,
  ...spacesExtra,
  ...updates,
} as const

export type Fr = typeof fr
