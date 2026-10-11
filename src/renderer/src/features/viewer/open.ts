/**
 * Ouverture de la vue détail depuis une liste (grille, recherche, palette, notification) : la liste
 * d'origine est conservée pour ←/→ et le compteur « 3 / 408 » (ERRATA §C).
 */
import type { ItemCard } from '../../../../shared/dto/items'
import { useUi } from '../../state/ui'

let source: Map<string, ItemCard> = new Map()

/** Cartes de la liste d'origine (affichage immédiat avant `items.get`). */
export function sourceCard(uuid: string): ItemCard | undefined {
  return source.get(uuid)
}

export function openViewer(card: ItemCard, list: readonly ItemCard[]): void {
  const cards = list.some((c) => c.uuid === card.uuid) ? list : [card, ...list]
  source = new Map(cards.map((c) => [c.uuid, c]))
  useUi.getState().openOverlay({ type: 'viewer', uuid: card.uuid, ids: cards.map((c) => c.uuid) })
}

/** Ouverture sans liste (notification, « Ouvrir avec », capture) : compteur « 1 / 1 ». */
export function openViewerByUuid(uuid: string): void {
  source = new Map()
  useUi.getState().openOverlay({ type: 'viewer', uuid, ids: [uuid] })
}
