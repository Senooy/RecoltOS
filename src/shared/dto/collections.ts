/**
 * DTO des collections et tags (PLAN §4.3, ERRATA §C).
 */
import { z } from 'zod'
import { HexColor, Source, Uuid } from '../enums'
import { ItemCard } from './items'

/** Nœud d'arbre : `count` = membres directs non supprimés (masqués compris), `covers` ≤ 3. */
export const CollectionNode = z.object({
  uuid: Uuid,
  name: z.string(),
  color: HexColor,
  parentUuid: Uuid.nullable(),
  orderIndex: z.number(),
  count: z.number().int().min(0),
  covers: z.array(ItemCard).max(3),
  coverItemUuid: Uuid.nullable(),
  aiExcluded: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  viewedAt: z.number().int().nullable(),
  get children() {
    return z.array(CollectionNode)
  },
})
export type CollectionNode = z.output<typeof CollectionNode>

export const TagInfo = z.object({
  uuid: Uuid,
  name: z.string(),
  color: HexColor.nullable(),
  count: z.number().int().min(0),
})
export type TagInfo = z.output<typeof TagInfo>

/** Chips virtuelles `#x #instagram #cosmos` dérivées de `items.source` (PLAN §1.4). */
export const SourceChip = z.object({ source: Source, count: z.number().int().min(0) })
export type SourceChip = z.output<typeof SourceChip>
