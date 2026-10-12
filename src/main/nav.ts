/**
 * Opening an item requested by main (capture notification, "Open with"): the `nav.openItem`
 * event is emitted AND the item is kept pending, for a recreated window whose
 * renderer does not listen yet (`system.takePendingNav` on mount). The renderer consumes the pending item.
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
