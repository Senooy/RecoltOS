/**
 * Chronological order of synced posts: `created_at` assigned relative to
 * the already-known neighbour. `incremental`: anchor fixed at the start of the run, new items go first
 * in the platform's order. `backfill`, `deep` and `passive` with a cursor: the anchor follows the last
 * known neighbour (1 ms re-anchoring below) and is persisted between backfill slices.
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
  /** Placed below an older neighbour than the start of the run (backfill / deep). */
  recovered: boolean
}

/**
 * Assigns `createdAt` to NEW posts (in the platform's order, from newest to
 * oldest). Known ones re-anchor (outside incremental); discarded and known ones without an element
 * do nothing. Modifies `cur` (persisted by the caller for backfill).
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
