/** Contrat `items.*` (ARCHI §2.3, ERRATA §B ; `items.rediscoverDeck` remplacé par `rediscover.*`). */
import { z } from 'zod'
import { ItemCard, ItemDetail, ItemsPage, TabCounts } from '../dto/items'
import { HexColor, ItemKind, LibraryTab, SortMode, Source, Uuid, WebUrl } from '../enums'
import { Count, Empty, Void, type ContractShape, type EventShape } from './define'

export const ItemFilters = z.object({
  kinds: z.array(ItemKind).optional(),
  sources: z.array(Source).optional(),
  tagUuids: z.array(Uuid).optional(),
  color: HexColor.optional(),
  /** Bornes en ms epoch, incluses (ERRATA §B). */
  period: z
    .object({ from: z.number().int().nullable(), to: z.number().int().nullable() })
    .optional(),
  collectionUuid: Uuid.optional(),
})
export type ItemFilters = z.output<typeof ItemFilters>

const ListCommon = {
  sort: SortMode.default('recent'),
  /** Tri aléatoire stable. */
  seed: z.number().int().optional(),
  /** Keyset opaque (base64url). */
  cursor: z.string().nullable().default(null),
  limit: z.number().int().min(1).max(500).default(120),
  filters: ItemFilters.optional(),
}

export const ItemsListInput = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('library'), tab: LibraryTab.default('all'), ...ListCommon }),
  /** Membres DIRECTS non supprimés ; les masqués y restent visibles. */
  z.object({ scope: z.literal('collection'), collectionUuid: Uuid, ...ListCommon }),
])
export type ItemsListInput = z.input<typeof ItemsListInput>

const Uuids = z.array(Uuid).min(1).max(10_000)

export const itemsContract = {
  'items.list': { input: ItemsListInput, output: ItemsPage },
  'items.counts': { input: Empty, output: TabCounts },
  'items.get': { input: z.object({ uuid: Uuid }), output: ItemDetail },
  'items.update': {
    input: z.object({
      uuid: Uuid,
      patch: z
        .object({
          title: z.string().max(500).nullable(),
          notes: z.string().max(20_000).nullable(),
          sourceUrl: WebUrl.nullable(),
        })
        .partial(),
    }),
    output: ItemDetail,
  },
  'items.trash': { input: z.object({ uuids: Uuids }), output: Count },
  'items.restore': { input: z.object({ uuids: Uuids }), output: Count },
  'items.purge': { input: z.object({ uuids: Uuids }), output: Count },
  'items.emptyTrash': { input: Empty, output: Count },
  'items.setHidden': { input: z.object({ uuids: Uuids, hidden: z.boolean() }), output: Count },
  'items.setAiExcluded': {
    input: z.object({ uuids: Uuids, excluded: z.boolean() }),
    output: Count,
  },
  'items.markViewed': { input: z.object({ uuid: Uuid }), output: Void },
  'items.recentlyViewed': {
    input: z.object({ limit: z.number().int().min(1).max(50).default(12) }).default({ limit: 12 }),
    output: z.array(ItemCard),
  },
} as const satisfies ContractShape

export const ItemsChangedReason = z.enum([
  'created',
  'updated',
  'trashed',
  'restored',
  'purged',
  'hidden',
  'derived',
  'ai',
])

export const itemsEvents = {
  'items.changed': z.object({ uuids: z.array(Uuid), reason: ItemsChangedReason }),
} as const satisfies EventShape
