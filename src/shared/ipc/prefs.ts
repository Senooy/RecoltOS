/** Contrat `prefs.*` : patch profond, strict, validé aux deux bouts (entrée IPC, puis après fusion). */
import { z } from 'zod'
import { PrefsSchema, type PrefsPatch } from '../prefs'
import { Empty, type ContractShape, type EventShape } from './define'

/**
 * Réglages que le renderer ne peut PAS écrire par `prefs.set` :
 * - `version` ;
 * - `ai.consentVersion` / `ai.consentAt` : canal dédié `ai.consent{version}` (AI §11) ;
 * - `ai.lastSeenVersions` : posé par la détection des CLI côté main ;
 * - `tools.*` : chemins d'exécutables lancés par main, posés par `system.redetectTools`.
 * `ai.claude.path` / `ai.codex.path` (surcharge manuelle, AI §3) restent écrivables mais main DOIT
 * vérifier que le fichier existe et est exécutable avant de les utiliser.
 */
export const PREFS_PATCH_DENIED = {
  top: ['version', 'tools'],
  ai: ['consentVersion', 'consentAt', 'lastSeenVersions'],
} as const

/** Patch accepté du renderer : `PrefsPatch` sans les réglages réservés. */
export type UserPrefsPatch = Omit<PrefsPatch, 'version' | 'tools' | 'ai'> & {
  ai?: Omit<NonNullable<PrefsPatch['ai']>, 'consentVersion' | 'consentAt' | 'lastSeenVersions'>
}

type AnyZod = z.ZodType

/**
 * Schéma de patch : tout est optionnel, SANS les défauts (un `.default()` réécrirait les réglages
 * absents du patch), les objets sont `.strict()` (clé inconnue ou réservée = rejet).
 */
function toPatchSchema(schema: AnyZod, denied: readonly string[] = []): AnyZod {
  if (schema instanceof z.ZodDefault || schema instanceof z.ZodPrefault) {
    return toPatchSchema(schema.def.innerType as AnyZod, denied)
  }
  if (schema instanceof z.ZodOptional) {
    return toPatchSchema(schema.def.innerType as AnyZod, denied).optional()
  }
  if (schema instanceof z.ZodNullable) {
    return toPatchSchema(schema.def.innerType as AnyZod, denied).nullable()
  }
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, AnyZod> = {}
    for (const [key, value] of Object.entries<AnyZod>(schema.shape)) {
      if (denied.includes(key)) continue
      const nested: readonly string[] = key === 'ai' ? PREFS_PATCH_DENIED.ai : []
      shape[key] = toPatchSchema(value, nested).optional()
    }
    return z.object(shape).strict()
  }
  return schema
}

export const PrefsPatchInput = toPatchSchema(
  PrefsSchema,
  PREFS_PATCH_DENIED.top,
) as unknown as z.ZodType<UserPrefsPatch>

export const prefsContract = {
  'prefs.get': { input: Empty, output: PrefsSchema },
  'prefs.set': { input: z.object({ patch: PrefsPatchInput }), output: PrefsSchema },
} as const satisfies ContractShape

export const prefsEvents = {
  'prefs.changed': PrefsSchema,
} as const satisfies EventShape
