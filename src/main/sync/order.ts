/**
 * Ordre chronologique des publications synchronisées : `created_at` attribué par rapport
 * au voisin déjà connu. `incremental` : ancre fixée au début du run, les nouveautés passent en tête
 * dans l'ordre de la plateforme. `backfill`, `deep` et `passive` avec curseur : l'ancre suit le dernier
 * voisin connu (recalage 1 ms dessous) et est persistée entre les tranches de backfill.
 */
export type RunMode = 'incremental' | 'backfill' | 'deep' | 'passive'

export interface OrderCursor {
  anchorAt: number
  pos: number
}

export type Known =
  | { state: 'saved'; createdAt: number }
  | { state: 'known_no_save' }
  | { state: 'dismissed' }
  | { state: 'new' }

export function startOrder(
  mode: RunMode,
  st: { backfill_anchor_at: number | null; backfill_pos: number },
  now: number,
): OrderCursor {
  return mode === 'backfill' && st.backfill_anchor_at != null
    ? { anchorAt: st.backfill_anchor_at, pos: st.backfill_pos }
    : { anchorAt: now, pos: 0 }
}

export interface Placed {
  sourceKey: string
  createdAt: number
  /** Placé sous un voisin plus ancien que le début du run (backfill / deep). */
  recovered: boolean
}

/**
 * Attribue `createdAt` aux NOUVELLES publications (dans l'ordre de la plateforme, du plus récent au
 * plus ancien). Les connues recalent l'ancre (hors incrémental) ; écartées et connues sans élément ne
 * font rien. Modifie `cur` (persisté par l'appelant pour le backfill).
 */
export function assignCreatedAt(
  mode: RunMode,
  posts: readonly { sourceKey: string }[],
  cur: OrderCursor,
  lookup: (key: string) => Known,
  runStartedAt: number,
): Placed[] {
  const out: Placed[] = []
  for (const p of posts) {
    const k = lookup(p.sourceKey)
    if (k.state === 'saved') {
      if (mode !== 'incremental') {
        cur.anchorAt = k.createdAt
        cur.pos = 0
      }
      continue
    }
    if (k.state !== 'new') continue
    cur.pos += 1
    const createdAt = cur.anchorAt - cur.pos
    out.push({
      sourceKey: p.sourceKey,
      createdAt,
      recovered: mode !== 'incremental' && mode !== 'passive' && cur.anchorAt < runStartedAt,
    })
  }
  return out
}
