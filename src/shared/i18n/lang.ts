/**
 * UI language (French or English), dependency-free: shared by main, the workers
 * and the renderer. Each process holds ITS active language (`setLang`); the default is French
 * (tests, first moments of startup).
 *
 * Detection rule: the Mac's first preferred language decides. French (`fr`, `fr-FR`,
 * `fr-CA`…) → French; any other language → English.
 */

export const LANGS = ['fr', 'en'] as const
export type Lang = (typeof LANGS)[number]

/** `ui.language` setting: `system` follows the Mac's language. */
export const LANGUAGE_PREFS = ['system', 'fr', 'en'] as const
export type LanguagePref = (typeof LANGUAGE_PREFS)[number]

export function isLang(v: unknown): v is Lang {
  return v === 'fr' || v === 'en'
}

/** `fr`, `fr-FR`, `fr_CA`… → `fr`; everything else (including empty) → `en`. */
export function langFromLocale(locale: string | null | undefined): Lang {
  return /^fr(?:[-_]|$)/i.test((locale ?? '').trim()) ? 'fr' : 'en'
}

/** First non-empty locale of the list (the system's preferred languages), otherwise `en`. */
export function langFromLocales(locales: readonly (string | null | undefined)[]): Lang {
  const first = locales.find((l) => typeof l === 'string' && l.trim() !== '')
  return langFromLocale(first)
}

/** Effective language: the explicit setting, otherwise the system one. */
export function resolveLang(pref: LanguagePref | undefined, systemLang: Lang): Lang {
  return pref === 'fr' || pref === 'en' ? pref : systemLang
}

let current: Lang = 'fr'
const listeners = new Set<(lang: Lang) => void>()

export function getLang(): Lang {
  return current
}

/** Changes the process's active language; listeners are only called if it changes. */
export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  for (const l of listeners) l(lang)
}

export function onLangChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Picks a text by the active language (standalone texts outside the catalog: validation,
 * labels).
 */
export function pick(texts: Record<Lang, string>, lang: Lang = current): string {
  return texts[lang]
}
