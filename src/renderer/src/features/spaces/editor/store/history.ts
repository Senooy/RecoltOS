/**
 * Home-made history: diff per touched node (`before` / `after`, `null` = absent), stack of
 * 200 entries, coalescing by key (arrows: same selection, < 600 ms). Not persisted, viewport
 * outside the history.
 */
import type { SpaceNode } from '../../../../../../shared/spaces-schema'

export const HISTORY_LIMIT = 200
export const COALESCE_MS = 600

export interface Entry {
  label: string
  before: Record<string, SpaceNode | null>
  after: Record<string, SpaceNode | null>
  key?: string
  at: number
}

export class History {
  past: Entry[] = []
  future: Entry[] = []

  push(e: Entry): void {
    this.future = []
    const last = this.past[this.past.length - 1]
    if (e.key && last?.key === e.key && e.at - last.at < COALESCE_MS) {
      for (const [id, n] of Object.entries(e.before)) if (!(id in last.before)) last.before[id] = n
      Object.assign(last.after, e.after)
      last.at = e.at
      return
    }
    this.past.push(e)
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
  }

  undo(): Entry | null {
    const e = this.past.pop()
    if (!e) return null
    this.future.push(e)
    return e
  }

  redo(): Entry | null {
    const e = this.future.pop()
    if (!e) return null
    this.past.push(e)
    return e
  }

  clear(): void {
    this.past = []
    this.future = []
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }
}

/** Applies one side of an entry to the node state (copy). Returns the touched uuids. */
export function applySide(
  nodes: Record<string, SpaceNode>,
  side: Record<string, SpaceNode | null>,
): { nodes: Record<string, SpaceNode>; ids: string[] } {
  const next = { ...nodes }
  const ids = Object.keys(side)
  for (const id of ids) {
    const n = side[id]
    if (n) next[id] = n
    else delete next[id]
  }
  return { nodes: next, ids }
}

/** Diff between two states: uuids modified, added or removed (reference comparison). */
export function diffIds(
  before: Record<string, SpaceNode>,
  after: Record<string, SpaceNode>,
): string[] {
  const out: string[] = []
  for (const id of Object.keys(after)) if (after[id] !== before[id]) out.push(id)
  for (const id of Object.keys(before)) if (!(id in after)) out.push(id)
  return out
}
