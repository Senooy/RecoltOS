/**
 * Ouverture d'un élément demandée par main (notification de capture, « Ouvrir avec ») : l'événement
 * `nav.openItem` est émis ET l'élément est gardé en attente, pour une fenêtre recréée dont le
 * renderer n'écoute pas encore (`system.takePendingNav` au montage). Le renderer consomme l'attente.
 */
import { emitEvent } from './events'

let pending: { uuid: string; at: number } | null = null
const TTL_MS = 30_000

export function requestOpenItem(uuid: string, now = Date.now()): void {
  pending = { uuid, at: now }
  emitEvent('nav.openItem', { uuid })
}

export function takePendingNav(now = Date.now()): { uuid: string } | null {
  const p = pending
  pending = null
  return p && now - p.at <= TTL_MS ? { uuid: p.uuid } : null
}
