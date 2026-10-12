/** `search.*` contract (FTS5 only, `{items,total}`; no `search.similar`). */
import { z } from 'zod'
import { TagInfo } from '../dto/collections'
import { ItemCard, NamedRef } from '../dto/items'
import { Empty, Void, type ContractShape } from './define'
import { ItemFilters } from './items'

export const searchContract = {
  'search.query': {
    input: z.object({
      q: z.string().max(500),
      filters: ItemFilters.optional(),
      limit: z.number().int().min(1).max(1000).default(300),
    }),
    output: z.object({
      items: z.array(ItemCard),
      total: z.number().int().min(0),
      /** Items discarded by the color filter for lack of a palette. */
      noPalette: z.number().int().min(0).default(0),
    }),
  },
  'search.suggest': {
    input: z.object({ q: z.string().max(200) }),
    output: z.object({ tags: z.array(TagInfo), collections: z.array(NamedRef) }),
  },
  'search.history.list': {
    input: Empty,
    output: z.array(
      z.object({ query: z.string(), usedAt: z.number().int(), uses: z.number().int() }),
    ),
  },
  'search.history.add': {
    input: z.object({ query: z.string().trim().min(1).max(500) }),
    output: Void,
  },
  'search.history.clear': { input: Empty, output: Void },
} as const satisfies ContractShape
