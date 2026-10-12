/**
 * Bounded renderer caches: a `Map` keeps insertion order, the oldest entry
 * leaves first. Writing an existing key moves it to the front.
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
