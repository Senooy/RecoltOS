/**
 * Zod error messages in the interface language: toasts display `error.message`.
 * Deliberate and sole side effect: imported by `enums.ts` and `ipc/define.ts`, hence by
 * main and renderer. The preload imports neither zod nor this module. Follows `setLang`
 * (hot change).
 */
import { z } from 'zod'
import { getLang, onLangChange, type Lang } from './i18n/lang'

export function applyZodLocale(lang: Lang): void {
  z.config(lang === 'fr' ? z.locales.fr() : z.locales.en())
}

applyZodLocale(getLang())
onLangChange(applyZodLocale)
