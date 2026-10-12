/** Repository root and manifest of `shots` captures. */
import { resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '../..')

/**
 * Merges the results of a `shots` run into the existing manifest. Key = scene + theme:
 * a re-run scene replaces its entry, the others stay (otherwise `shots --scene a` would erase the
 * captures of a previous run).
 */
export function mergeManifest<T extends { scene: string; theme: string }>(
  existing: readonly T[],
  fresh: readonly T[],
): T[] {
  const key = (e: { scene: string; theme: string }): string => `${e.scene}\u0000${e.theme}`
  const freshByKey = new Map(fresh.map((e) => [key(e), e] as const))
  const merged: T[] = []
  const seen = new Set<string>()
  for (const e of existing) {
    const k = key(e)
    if (seen.has(k)) continue
    seen.add(k)
    merged.push(freshByKey.get(k) ?? e)
  }
  for (const e of fresh) {
    const k = key(e)
    if (!seen.has(k)) {
      seen.add(k)
      merged.push(e)
    }
  }
  return merged
}
