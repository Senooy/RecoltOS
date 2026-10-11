/**
 * Contrat `ai.*` (PLAN §4.4, AI §12.3). Aucun appel sans `consentVersion` ni avec `provider = 'off'`.
 */
import { z } from 'zod'
import { AI_FIELDS, AI_TASKS, ProviderStatus, ProviderTestResult } from '../ai-types'
import { AiCallEntry, AiEstimate, QueueSnapshot } from '../dto/ai'
import { Uuid } from '../enums'
import { JobType } from '../jobs'
import { AiFallbackPref, AiProviderPref } from '../prefs'
import { Count, Empty, Void, type ContractShape, type EventShape } from './define'

const Cli = z.enum(['claude', 'codex'])
const Task = z.enum(AI_TASKS)

export const AiFilter = z.object({
  missingDescription: z.boolean().optional(),
  importRunId: z.number().int().optional(),
  collectionUuid: Uuid.optional(),
  itemUuids: z.array(Uuid).max(10_000).optional(),
})

export const aiContract = {
  'ai.detect': {
    input: Empty,
    output: z.object({ claude: ProviderStatus, codex: ProviderStatus }),
  },
  'ai.status': {
    input: Empty,
    output: z.object({
      provider: AiProviderPref,
      fallback: AiFallbackPref,
      consentVersion: z.number().int().nullable(),
      queue: QueueSnapshot,
    }),
  },
  'ai.test': { input: z.object({ provider: Cli, live: z.boolean() }), output: ProviderTestResult },
  'ai.consent': { input: z.object({ version: z.number().int().min(1) }), output: Void },
  'ai.previewPayload': {
    input: z.object({ itemUuid: Uuid, task: Task }),
    output: z.object({
      provider: Cli,
      prompt: z.string(),
      files: z.array(
        z.object({ name: z.string(), bytes: z.number(), width: z.number(), height: z.number() }),
      ),
      textChars: z.number().int(),
    }),
  },
  'ai.estimate': { input: z.object({ filter: AiFilter }), output: AiEstimate },
  'ai.enqueue': {
    input: z.object({
      itemUuids: z.array(Uuid).max(10_000).optional(),
      filter: AiFilter.optional(),
      task: Task,
      force: z.boolean().optional(),
      fields: z.array(z.enum(AI_FIELDS)).optional(),
    }),
    output: z.object({ queued: z.number().int() }),
  },
  'ai.batch.create': {
    input: z.object({
      scope: z.enum(['unanalyzed', 'regenerate-fr', 'all', 'import', 'collection']),
      collectionUuid: Uuid.optional(),
    }),
    output: z.object({ planId: Uuid, label: z.string(), estimate: AiEstimate }),
  },
  'ai.batch.start': { input: z.object({ planId: Uuid }), output: z.object({ batchUuid: Uuid }) },
  'ai.queue.control': {
    input: z.object({
      action: z.enum(['pause', 'resume', 'cancel', 'retryFailed']),
      batchUuid: Uuid.optional(),
      type: JobType.optional(),
      provider: Cli.optional(),
    }),
    output: Void,
  },
  'ai.budget.override': { input: z.object({ until: z.number().int() }), output: Void },
  'ai.calls.list': {
    input: z
      .object({ limit: z.number().int().min(1).max(1000).default(100) })
      .default({ limit: 100 }),
    output: z.array(AiCallEntry),
  },
  'ai.calls.clear': { input: Empty, output: Count },
} as const satisfies ContractShape

export const aiEvents = {
  'ai.queue': QueueSnapshot,
  'ai.result': z.object({ uuid: Uuid }),
} as const satisfies EventShape
