/** `collections.*` contract. Cycles refused (`collection_cycle`). */
import { z } from 'zod'
import { CollectionNode } from '../dto/collections'
import { HexColor, Uuid } from '../enums'
import { Count, Empty, Void, type ContractShape, type EventShape } from './define'

const Name = z.string().trim().min(1).max(200)

export const collectionsContract = {
  /** Roots; each node carries its `children`. */
  'collections.tree': { input: Empty, output: z.array(CollectionNode) },
  'collections.create': {
    input: z.object({
      name: Name,
      parentUuid: Uuid.nullable().optional(),
      color: HexColor.optional(),
    }),
    output: CollectionNode,
  },
  'collections.update': {
    input: z.object({
      uuid: Uuid,
      name: Name.optional(),
      color: HexColor.optional(),
      coverItemUuid: Uuid.nullable().optional(),
      parentUuid: Uuid.nullable().optional(),
      aiExcluded: z.boolean().optional(),
    }),
    output: CollectionNode,
  },
  /** `keepChildren: false` also deletes the sub-collections (UI confirmation). */
  'collections.delete': {
    input: z.object({ uuid: Uuid, keepChildren: z.boolean() }),
    output: Count,
  },
  'collections.reorder': {
    input: z.object({ uuid: Uuid, beforeUuid: Uuid.nullable().optional() }),
    output: Void,
  },
  'collections.addItems': {
    input: z.object({ collectionUuid: Uuid, itemUuids: z.array(Uuid).min(1).max(10_000) }),
    output: Count,
  },
  'collections.removeItems': {
    input: z.object({ collectionUuid: Uuid, itemUuids: z.array(Uuid).min(1).max(10_000) }),
    output: Count,
  },
  'collections.markViewed': { input: z.object({ uuid: Uuid }), output: Void },
} as const satisfies ContractShape

export const collectionsEvents = {
  'collections.changed': z.object({ uuids: z.array(Uuid) }),
} as const satisfies EventShape
