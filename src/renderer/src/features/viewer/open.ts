/**
 * Opening the detail view from a list (grid, search, palette, notification): the original list is
 * kept for ←/→ and the "3 / 408" counter.
 */
import type { ItemCard } from '../../../../shared/dto/items'
import { useUi } from '../../state/ui'

let source: Map<string, ItemCard> = new Map()

/** Cards of the original list (immediate display before `items.get`). */
export function sourceCard(uuid: string): ItemCard | undefined {
  return source.get(uuid)
}

export function openViewer(card: ItemCard, list: readonly ItemCard[]): void {
  const cards = list.some((c) => c.uuid === card.uuid) ? list : [card, ...list]
  source = new Map(cards.map((c) => [c.uuid, c]))
  useUi.getState().openOverlay({ type: 'viewer', uuid: card.uuid, ids: cards.map((c) => c.uuid) })
}

/** Opening without a list (notification, "Open with", capture): counter "1 / 1". */
export function openViewerByUuid(uuid: string): void {
  source = new Map()
  useUi.getState().openOverlay({ type: 'viewer', uuid, ids: [uuid] })
}
