/**
 * Pluriel français : 0 et 1 au singulier (« 0 élément », « 1 élément », « 2 éléments »).
 */
export function isPlural(n: number): boolean {
  return Math.abs(n) >= 2
}

export function plural(n: number, one: string, many: string): string {
  return isPlural(n) ? many : one
}

/** « 3 éléments » ; l'espace insécable fine (U+202F) des milliers est gérée par `lib/format.ts`. */
export function count(
  n: number,
  one: string,
  many: string,
  format: (n: number) => string = String,
): string {
  return `${format(n)} ${plural(n, one, many)}`
}
