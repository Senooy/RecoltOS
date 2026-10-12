/**
 * Main process texts in the active language (`getLang()` from `shared/i18n/lang`). Without import
 * `electron`: usable by the database, import, ingestion, AI, sync and workers.
 * `mt()` is re-read on each message (live language change).
 */
import { getLang, type Lang } from '../../shared/i18n/lang'
import { mainEn } from './en'
import { mainFr } from './fr'

export type MainMessages = typeof mainEn

const CATALOGS: Record<Lang, MainMessages> = { fr: mainFr, en: mainEn }

/** Catalog of the active language (or of `lang`). */
export function mt(lang: Lang = getLang()): MainMessages {
  return CATALOGS[lang]
}

/** `Intl` locale of the active language: `fr-FR` or `en-US`. */
export function intlLocale(lang: Lang = getLang()): string {
  return lang === 'fr' ? 'fr-FR' : 'en-US'
}

let systemLang: Lang = 'fr'

/** System language (first preferred language of the Mac, or `RECOLTOS_LANG`), set at startup. */
export function getSystemLang(): Lang {
  return systemLang
}

export function setSystemLang(lang: Lang): void {
  systemLang = lang
}
