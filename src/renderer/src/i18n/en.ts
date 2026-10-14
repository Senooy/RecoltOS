/**
 * English aggregator: `en/base.ts` + one file per domain, same list and order as `fr.ts`.
 * `Messages` (the type of the active catalog) is derived from `Fr`.
 */
import type { Widen } from '../../../shared/i18n/messages'
import type { Fr } from './fr'
import { ai } from './en/ai'
import { base } from './en/base'
import { capture } from './en/capture'
import { collection } from './en/collection'
import { color } from './en/color'
import { grid } from './en/grid'
import { library } from './en/library'
import { palette } from './en/palette'
import { rediscover } from './en/rediscover'
import { search } from './en/search'
import { settings } from './en/settings'
import { settingsMore } from './en/settings-more'
import { shelf } from './en/shelf'
import { shell } from './en/shell'
import { spaces } from './en/spaces'
import { spacesExtra } from './en/spaces-extra'
import { sync } from './en/sync'
import { updates } from './en/updates'
import { viewer } from './en/viewer'

export type Messages = Widen<Fr>

export const en: Messages = {
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
}
