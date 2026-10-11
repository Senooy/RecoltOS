/**
 * État des filtres de la Recherche (DESIGN §3.5) et conversion vers `ItemFilters` (ERRATA §B).
 */
import type { ItemKind, Source } from '../../../../shared/enums'
import type { ItemFilters } from '../../../../shared/ipc/items'

export type Period = 'all' | '7d' | '30d' | '1y'

export interface SearchFilters {
  kinds: ItemKind[]
  sources: Source[]
  color: string | null
  period: Period
  collectionUuid: string | null
  tags: { uuid: string; name: string }[]
}

export const EMPTY_FILTERS: SearchFilters = {
  kinds: [],
  sources: [],
  color: null,
  period: 'all',
  collectionUuid: null,
  tags: [],
}

const DAY = 86_400_000
const PERIOD_MS: Record<Exclude<Period, 'all'>, number> = {
  '7d': 7 * DAY,
  '30d': 30 * DAY,
  '1y': 365 * DAY,
}

export function activeCount(f: SearchFilters): number {
  return (
    f.kinds.length +
    f.sources.length +
    (f.color ? 1 : 0) +
    (f.period !== 'all' ? 1 : 0) +
    (f.collectionUuid ? 1 : 0) +
    f.tags.length
  )
}

export function toItemFilters(f: SearchFilters, now: number = Date.now()): ItemFilters {
  return {
    ...(f.kinds.length ? { kinds: f.kinds } : {}),
    ...(f.sources.length ? { sources: f.sources } : {}),
    ...(f.color ? { color: f.color } : {}),
    ...(f.period !== 'all' ? { period: { from: now - PERIOD_MS[f.period], to: null } } : {}),
    ...(f.collectionUuid ? { collectionUuid: f.collectionUuid } : {}),
    ...(f.tags.length ? { tagUuids: f.tags.map((t) => t.uuid) } : {}),
  }
}

export function toggle<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

/** 12 pastilles (DESIGN §3.5), du rouge au rose puis neutres. */
export const SWATCHES = [
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#34c759',
  '#00c7be',
  '#30b0c7',
  '#007aff',
  '#5856d6',
  '#af52de',
  '#ff2d55',
  '#ffffff',
  '#1c1c1e',
] as const
