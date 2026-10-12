/** Shared building blocks for the per-domain IPC contracts. */
import { z } from 'zod'
import '../zod-locale'

export interface ChannelDef {
  input: z.ZodType
  output: z.ZodType
}
export type ContractShape = Record<string, ChannelDef>
export type EventShape = Record<string, z.ZodType>

/** Empty input: `rpc('items.counts')` or `rpc('items.counts', {})`. */
export const Empty = z.object({}).default({})
/** Output without value. */
export const Void = z.void()
export const Count = z.object({ count: z.number().int().min(0) })

/** Absolute file path received from the renderer (re-validated in main: realpath + root). */
export const AbsPath = z
  .string()
  .min(1)
  .max(4096)
  .startsWith('/')
  .refine((p) => !p.split('/').some((seg) => seg === '.' || seg === '..'), {
    message: 'absolute path without . or .. segments',
  })
  .refine((p) => !p.includes('\0') && !p.includes('//') && p !== '/', {
    message: 'absolute path without NUL byte, without "//" and distinct from the root',
  })
