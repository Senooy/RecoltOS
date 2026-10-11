/**
 * État des filtres de la Recherche (DESIGN §3.5) et conversion vers `ItemFilters` (ERRATA §B).
 */
import { DEFAULT_COLOR_TOLERANCE, NAMED_COLORS } from '../../../../shared/color'
import type { ItemKind, Source } from '../../../../shared/enums'
import type { ItemFilters } from '../../../../shared/ipc/items'

export type Period = 'all' | '7d' | '30d' | '1y'

export interface SearchFilters {
  kinds: ItemKind[]
  sources: Source[]
  /** Couleurs du filtre (intersection), hex. */
  colors: string[]
  /** Tolérance ΔE2000 (défaut 18). */
  tolerance: number
  period: Period
  collectionUuid: string | null
  tags: { uuid: string; name: string }[]
}

export const EMPTY_FILTERS: SearchFilters = {
  kinds: [],
  sources: [],
  colors: [],
  tolerance: DEFAULT_COLOR_TOLERANCE,
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
    f.colors.length +
    (f.period !== 'all' ? 1 : 0) +
    (f.collectionUuid ? 1 : 0) +
    f.tags.length
  )
}

export function toItemFilters(f: SearchFilters, now: number = Date.now()): ItemFilters {
  return {
    ...(f.kinds.length ? { kinds: f.kinds } : {}),
    ...(f.sources.length ? { sources: f.sources } : {}),
    ...(f.colors.length ? { colors: f.colors } : {}),
    ...(f.colors.length && f.tolerance !== DEFAULT_COLOR_TOLERANCE
      ? { colorTolerance: f.tolerance }
      : {}),
    ...(f.period !== 'all' ? { period: { from: now - PERIOD_MS[f.period], to: null } } : {}),
    ...(f.collectionUuid ? { collectionUuid: f.collectionUuid } : {}),
    ...(f.tags.length ? { tagUuids: f.tags.map((t) => t.uuid) } : {}),
  }
}

export function toggle<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

/** 12 pastilles nommées (AI §9.2), du rouge au rose puis neutres. */
export const SWATCHES = NAMED_COLORS

/** Libellé d'une couleur du filtre : nom si c'est une pastille, sinon l'hex. */
export function colorLabel(hex: string): string {
  return NAMED_COLORS.find((c) => c.hex === hex.toLowerCase())?.label ?? hex
}
