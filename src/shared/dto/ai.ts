/**
 * DTO IA (`QueueSnapshot` sans voie embed, `ProviderStatus`).
 */
import { z } from 'zod'
import { PauseReason, ProviderStatus, ProviderTestResult } from '../ai-types'
import { Uuid } from '../enums'

export { ProviderStatus, ProviderTestResult }

const LaneCounts = {
  running: z.number().int(),
  queued: z.number().int(),
  done: z.number().int(),
  failed: z.number().int(),
}

export const ProviderLane = z.object({
  running: z.number().int(),
  paused: z.object({ reason: PauseReason, until: z.number().int().optional() }).optional(),
})

export const QueueSnapshot = z.object({
  cli: z.object({
    ...LaneCounts,
    providers: z.object({ claude: ProviderLane, codex: ProviderLane }),
  }),
  palette: z.object(LaneCounts),
  budget: z.object({
    hourUsed: z.number().int(),
    hourLimit: z.number().int(),
    dayUsed: z.number().int(),
    dayLimit: z.number().int(),
  }),
  batch: z
    .object({
      uuid: Uuid,
      label: z.string(),
      total: z.number().int(),
      done: z.number().int(),
      failed: z.number().int(),
      etaSec: z.number().int(),
    })
    .optional(),
})
export type QueueSnapshot = z.output<typeof QueueSnapshot>

export const AiCallEntry = z.object({
  id: z.number().int(),
  ts: z.number().int(),
  itemUuid: Uuid.nullable(),
  provider: z.enum(['claude', 'codex']),
  model: z.string().nullable(),
  task: z.string(),
  sentFiles: z.array(
    z.object({ name: z.string(), bytes: z.number(), width: z.number(), height: z.number() }),
  ),
  sentTextChars: z.number().int(),
  durationMs: z.number().int().nullable(),
  outcome: z.enum(['ok', 'error', 'rate_limited', 'cancelled', 'timeout', 'violation']),
  errorCode: z.string().nullable(),
})
export type AiCallEntry = z.output<typeof AiCallEntry>

export const AiEstimate = z.object({
  count: z.number().int(),
  provider: z.enum(['claude', 'codex', 'none']),
  calls: z.number().int(),
  etaSec: z.number().int(),
})
export type AiEstimate = z.output<typeof AiEstimate>
