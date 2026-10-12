/** Racine du dépôt et manifeste des captures de `shots`. */
import { resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '../..')

/**
 * Fusionne les résultats d'un lancement de `shots` dans le manifeste existant. Clé = scène + thème :
 * une scène relancée remplace son entrée, les autres restent (sinon `shots --scene a` effacerait les
 * captures d'un lancement précédent).
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
