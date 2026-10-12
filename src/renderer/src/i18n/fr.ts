/**
 * Agrégateur des textes FR : `fr/base.ts` + un fichier par domaine
 * UI, liste FIGÉE ci-dessous. Chaque fichier de domaine exporte un objet de namespaces.
 * Le catalogue anglais (`en.ts`, `en/<domaine>.ts`) a exactement les mêmes clés ; les composants
 * lisent la langue active par `tr` (`i18n/index.ts`), jamais `fr` directement.
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
} as const

export type Fr = typeof fr
