/** `sync.*` contract. */
import { z } from 'zod'
import { ItemCard } from '../dto/items'
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
  /** Items caught up by the backfill, not yet reviewed ("Review" pill). */
  'sync.recovered': {
    input: z.object({ source: SyncSource.optional() }).default({}),
    output: z.object({ items: z.array(ItemCard) }),
  },
  'sync.ackRecovered': {
    input: z.object({ source: SyncSource.optional() }).default({}),
    output: Void,
  },
  /** Forgets the sync settings carried over from GatherOS (proposal handled). */
  'sync.clearImportedFlag': { input: z.object({ source: SyncSource }), output: Void },
} as const satisfies ContractShape

export const syncEvents = {
  'sync.status': SyncStatus,
} as const satisfies EventShape
