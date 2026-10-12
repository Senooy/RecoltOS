/**
 * Messages d'erreur zod dans la langue de l'interface : les toasts affichent `error.message`.
 * Effet de bord volontaire et unique : importé par `enums.ts` et `ipc/define.ts`, donc par
 * main et renderer. Le preload n'importe ni zod ni ce module. Suit `setLang` (changement à chaud).
 */
import { z } from 'zod'
import { getLang, onLangChange, type Lang } from './i18n/lang'

export function applyZodLocale(lang: Lang): void {
  z.config(lang === 'fr' ? z.locales.fr() : z.locales.en())
}

applyZodLocale(getLang())
onLangChange(applyZodLocale)
