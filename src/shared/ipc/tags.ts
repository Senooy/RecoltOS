/** Contrat `tags.*` (ARCHI §2.3, §4.5). Noms réservés `x`, `instagram`, `cosmos`, `bookmark` → `tag_reserved`. */
import { z } from 'zod'
import { SourceChip, TagInfo } from '../dto/collections'
import { Uuid } from '../enums'
import { Count, Empty, Void, type ContractShape } from './define'

export const RESERVED_TAG_NAMES = ['x', 'instagram', 'cosmos', 'bookmark'] as const

const TagName = z.string().trim().min(1).max(100)

export const tagsContract = {
  'tags.list': {
    input: Empty,
    output: z.object({ tags: z.array(TagInfo), sourceChips: z.array(SourceChip) }),
  },
  'tags.add': {
    input: z.object({ itemUuids: z.array(Uuid).min(1), names: z.array(TagName).min(1).max(50) }),
    output: Count,
  },
  'tags.remove': {
    input: z.object({ itemUuids: z.array(Uuid).min(1), tagUuids: z.array(Uuid).min(1) }),
    output: Count,
  },
  /** « Nouveau tag » (Réglages › Tags) : tag sans élément ; nom existant → le tag existant. */
  'tags.create': { input: z.object({ name: TagName }), output: TagInfo },
  'tags.rename': { input: z.object({ uuid: Uuid, name: TagName }), output: TagInfo },
  'tags.delete': { input: z.object({ uuid: Uuid }), output: Void },
  'tags.merge': {
    input: z.object({ sourceUuids: z.array(Uuid).min(1), targetUuid: Uuid }),
    output: TagInfo,
  },
} as const satisfies ContractShape
