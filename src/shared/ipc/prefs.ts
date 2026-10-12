/** `prefs.*` contract: deep patch, strict, validated at both ends (IPC input, then after merge). */
import { z } from 'zod'
import { PrefsSchema, type PrefsPatch } from '../prefs'
import { Empty, type ContractShape, type EventShape } from './define'

/**
 * Settings the renderer can NOT write through `prefs.set`:
 * - `version`;
 * - `ai.consentVersion` / `ai.consentAt`: dedicated channel `ai.consent{version}`;
 * - `ai.lastSeenVersions`: set by the CLI detection on the main side;
 * - `tools.*`: executable paths launched by main, set by `system.redetectTools`.
 * `ai.claude.path` / `ai.codex.path` (manual override) remain writable, but main MUST
 * check that the file exists and is executable before using them.
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
 * Patch schema: everything is optional, WITHOUT the defaults (a `.default()` would overwrite the settings
 * missing from the patch), objects are `.strict()` (unknown or reserved key = rejection).
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
