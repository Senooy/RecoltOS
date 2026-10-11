/** Contrat `prefs.*` : patch profond validé après fusion (`mergePrefs`). */
import { z } from 'zod'
import { PrefsSchema, type PrefsPatch } from '../prefs'
import { Empty, type ContractShape, type EventShape } from './define'

const isPlainObject = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export const PrefsPatchInput = z.custom<PrefsPatch>(isPlainObject, { message: 'objet attendu' })

export const prefsContract = {
  'prefs.get': { input: Empty, output: PrefsSchema },
  'prefs.set': { input: z.object({ patch: PrefsPatchInput }), output: PrefsSchema },
} as const satisfies ContractShape

export const prefsEvents = {
  'prefs.changed': PrefsSchema,
} as const satisfies EventShape
