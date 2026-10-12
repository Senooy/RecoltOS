/**
 * `rediscover.*` contract: weighted draw + `rediscover_log` + cooldowns.
 * Suggested collections = the 3 most recently used.
 */
import { z } from 'zod'
import { ItemCard, NamedRef } from '../dto/items'
import { Uuid } from '../enums'
import { Void, type ContractShape } from './define'

export const RediscoverAction = z.enum(['keep', 'trash', 'collection', 'skip'])

export const rediscoverContract = {
  'rediscover.deck': {
    input: z.object({
      seed: z.number().int(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
      collectionUuid: Uuid.optional(),
    }),
    output: z.object({
      sessionId: z.string(),
      /** N = number of eligible items ("1 / N" counter). */
      total: z.number().int(),
      items: z.array(ItemCard),
      suggestedCollections: z.array(NamedRef).max(3),
    }),
  },
  'rediscover.act': {
    input: z.object({
      itemUuid: Uuid,
      action: RediscoverAction,
      collectionUuid: Uuid.optional(),
      sessionId: z.string().optional(),
    }),
    output: Void,
  },
  /** Undoes the last action (≤ 10 s); `null` if nothing to undo. */
  'rediscover.undo': {
    input: z.object({}).default({}),
    output: z.object({ itemUuid: Uuid }).nullable(),
  },
} as const satisfies ContractShape
