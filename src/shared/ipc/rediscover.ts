/**
 * Contrat `rediscover.*` (PLAN §1.10, AI §10) : tirage pondéré + `rediscover_log` + cooldowns.
 * Collections proposées = 3 plus récemment utilisées (ERRATA §G).
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
      /** N = nombre d'éligibles (compteur « 1 / N »). */
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
  /** Annule la dernière action (≤ 10 s) ; `null` si rien à annuler. */
  'rediscover.undo': {
    input: z.object({}).default({}),
    output: z.object({ itemUuid: Uuid }).nullable(),
  },
} as const satisfies ContractShape
