/** Briques communes aux contrats IPC par domaine. */
import { z } from 'zod'
import '../zod-locale'

export interface ChannelDef {
  input: z.ZodType
  output: z.ZodType
}
export type ContractShape = Record<string, ChannelDef>
export type EventShape = Record<string, z.ZodType>

/** Entrée vide : `rpc('items.counts')` ou `rpc('items.counts', {})`. */
export const Empty = z.object({}).default({})
/** Sortie sans valeur. */
export const Void = z.void()
export const Count = z.object({ count: z.number().int().min(0) })

/** Chemin absolu de fichier reçu du renderer (revalidé côté main : realpath + racine). */
export const AbsPath = z
  .string()
  .min(1)
  .max(4096)
  .startsWith('/')
  .refine((p) => !p.split('/').some((seg) => seg === '.' || seg === '..'), {
    message: 'chemin absolu sans segment . ni ..',
  })
  .refine((p) => !p.includes('\0') && !p.includes('//') && p !== '/', {
    message: 'chemin absolu sans octet NUL, sans « // » et distinct de la racine',
  })
