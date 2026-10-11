/** Contrat `sync.*` (PLAN §4.4). */
import { z } from 'zod'
import { SyncRunInfo, SyncStatus } from '../dto/sync'
import { SyncSource } from '../enums'
import { Empty, Void, type ContractShape, type EventShape } from './define'

export const syncContract = {
  'sync.getStatus': { input: Empty, output: SyncStatus },
  'sync.setEnabled': { input: z.object({ source: SyncSource, on: z.boolean() }), output: Void },
  'sync.setAllowBackgroundTab': {
    input: z.object({ source: SyncSource, on: z.boolean() }),
    output: Void,
  },
  'sync.runNow': { input: z.object({ source: SyncSource.optional() }).default({}), output: Void },
  'sync.resyncAll': { input: z.object({ source: SyncSource }), output: Void },
  'sync.getRuns': {
    input: z.object({ source: SyncSource, limit: z.number().int().min(1).max(200).default(20) }),
    output: z.array(SyncRunInfo),
  },
} as const satisfies ContractShape

export const syncEvents = {
  'sync.status': SyncStatus,
} as const satisfies EventShape
