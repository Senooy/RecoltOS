/**
 * DTO capture (SPACES §2.3-2.4, PLAN §4.3), `saveId` → `itemUuid`.
 */
import { z } from 'zod'
import { Uuid } from '../enums'

export const ScreenAccess = z.enum(['granted', 'denied', 'not-determined', 'restricted', 'unknown'])
export type ScreenAccess = z.output<typeof ScreenAccess>

export const CaptureTrigger = z.enum(['shortcut', 'menu', 'palette', 'button'])

export const CaptureResult = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    itemUuid: Uuid,
    duplicate: z.boolean().optional(),
    viaClipboard: z.boolean().optional(),
    dropPath: z.string().optional(),
  }),
  z.object({ status: z.literal('cancelled') }),
  z.object({ status: z.literal('busy') }),
  z.object({ status: z.literal('permission-required'), access: ScreenAccess }),
  z.object({ status: z.literal('error'), message: z.string() }),
])
export type CaptureResult = z.output<typeof CaptureResult>

export const CaptureStatus = z.object({
  access: ScreenAccess,
  raw: z.string(),
  shortcut: z.string(),
  shortcutRegistered: z.boolean(),
  signature: z.enum(['adhoc', 'identity', 'unsigned', 'dev']),
  lastDropError: z.string().optional(),
})
export type CaptureStatus = z.output<typeof CaptureStatus>

export const ShortcutResult = z.object({
  ok: z.boolean(),
  error: z.enum(['conflict', 'invalid', 'reserved']).optional(),
})
export type ShortcutResult = z.output<typeof ShortcutResult>
