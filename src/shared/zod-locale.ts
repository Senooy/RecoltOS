/**
 * Messages d'erreur zod en français : les toasts affichent `error.message`.
 * Effet de bord volontaire et unique : importé par `enums.ts` et `ipc/define.ts`, donc par
 * main et renderer. Le preload n'importe ni zod ni ce module.
 */
import { z } from 'zod'

z.config(z.locales.fr())
