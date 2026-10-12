/** `capture.*` contract. */
import { z } from 'zod'
import { CaptureResult, CaptureStatus, ScreenAccess, ShortcutResult } from '../dto/capture'
import { Uuid } from '../enums'
import { CaptureMode } from '../prefs'
import { Empty, Void, type ContractShape, type EventShape } from './define'

export const captureContract = {
  'capture.run': {
    input: z.object({ mode: CaptureMode.optional(), collectionUuid: Uuid.optional() }).default({}),
    output: CaptureResult,
  },
  'capture.status': { input: Empty, output: CaptureStatus },
  'capture.setShortcut': {
    // Validated by the handler (`invalid` / `reserved` returned in the result, not as an error).
    input: z.object({ accel: z.string().min(1).max(64), label: z.string().min(1).max(20) }),
    output: ShortcutResult,
  },
  'capture.openPermissionPane': { input: Empty, output: Void },
  'capture.relaunch': { input: Empty, output: Void },
  'capture.pickDropFolder': { input: Empty, output: z.string().nullable() },
} as const satisfies ContractShape

export const captureEvents = {
  'capture.done': CaptureResult,
  'capture.permissionRequired': z.object({ access: ScreenAccess }),
} as const satisfies EventShape
