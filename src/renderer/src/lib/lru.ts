/**
 * Caches bornés du renderer : une `Map` garde l'ordre d'insertion, l'entrée la plus
 * ancienne part la première. Écrire une clé existante la remet en tête.
 */
export function lruSet<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key)
  map.set(key, value)
  while (map.size > max) {
    const oldest = map.keys().next()
    if (oldest.done) break
    map.delete(oldest.value)
  }
}
