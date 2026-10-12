/**
 * Textes du process main dans la langue active (`getLang()` de `shared/i18n/lang`). Sans import
 * `electron` : utilisable par la base, l'import, l'ingestion, l'IA, la sync et les workers.
 * `mt()` est relu à chaque message (changement de langue à chaud).
 */
import { getLang, type Lang } from '../../shared/i18n/lang'
import { mainEn } from './en'
import { mainFr } from './fr'

export type MainMessages = typeof mainEn

const CATALOGS: Record<Lang, MainMessages> = { fr: mainFr, en: mainEn }

/** Catalogue de la langue active (ou de `lang`). */
export function mt(lang: Lang = getLang()): MainMessages {
  return CATALOGS[lang]
}

/** Locale `Intl` de la langue active : `fr-FR` ou `en-US`. */
export function intlLocale(lang: Lang = getLang()): string {
  return lang === 'fr' ? 'fr-FR' : 'en-US'
}

let systemLang: Lang = 'fr'

/** Langue du système (première langue préférée du Mac, ou `RECOLTOS_LANG`), posée au démarrage. */
export function getSystemLang(): Lang {
  return systemLang
}

export function setSystemLang(lang: Lang): void {
  systemLang = lang
}
