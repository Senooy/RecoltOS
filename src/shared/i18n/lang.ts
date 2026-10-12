/**
 * Langue de l'interface (français ou anglais), sans dépendance : partagée par main, les workers
 * et le renderer. Chaque processus tient SA langue active (`setLang`) ; le défaut est le français
 * (tests, premiers instants du démarrage).
 *
 * Règle de détection : la première langue préférée du Mac décide. Français (`fr`, `fr-FR`,
 * `fr-CA`…) → français ; toute autre langue → anglais.
 */

export const LANGS = ['fr', 'en'] as const
export type Lang = (typeof LANGS)[number]

/** Réglage `ui.language` : `system` suit la langue du Mac. */
export const LANGUAGE_PREFS = ['system', 'fr', 'en'] as const
export type LanguagePref = (typeof LANGUAGE_PREFS)[number]

export function isLang(v: unknown): v is Lang {
  return v === 'fr' || v === 'en'
}

/** `fr`, `fr-FR`, `fr_CA`… → `fr` ; tout le reste (y compris vide) → `en`. */
export function langFromLocale(locale: string | null | undefined): Lang {
  return /^fr(?:[-_]|$)/i.test((locale ?? '').trim()) ? 'fr' : 'en'
}

/** Première locale non vide de la liste (langues préférées du système), sinon `en`. */
export function langFromLocales(locales: readonly (string | null | undefined)[]): Lang {
  const first = locales.find((l) => typeof l === 'string' && l.trim() !== '')
  return langFromLocale(first)
}

/** Langue effective : le réglage explicite, sinon celle du système. */
export function resolveLang(pref: LanguagePref | undefined, systemLang: Lang): Lang {
  return pref === 'fr' || pref === 'en' ? pref : systemLang
}

let current: Lang = 'fr'
const listeners = new Set<(lang: Lang) => void>()

export function getLang(): Lang {
  return current
}

/** Change la langue active du processus ; les écouteurs ne sont appelés que si elle change. */
export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  for (const l of listeners) l(lang)
}

export function onLangChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Choix d'un texte selon la langue active (textes isolés hors catalogue : validation, libellés). */
export function pick(texts: Record<Lang, string>, lang: Lang = current): string {
  return texts[lang]
}
